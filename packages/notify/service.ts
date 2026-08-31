// packages/notify/service.ts
// The turn-notification service: game-agnostic, host-level, two channels.
//
// The shape of the problem: the lobby is deliberately turn-agnostic and
// player identity is per-room (a seat id and a token), so neither "whose
// turn is it" nor "who is this, across rooms" exists anywhere the host can
// see. Games close over their own registries and hand the service exactly
// three capabilities (NotifyGameRegistration); players mint a random key in
// their own browser and prove seat ownership with the seat's rejoin token.
// The service owns everything between: the debounce, the once-per-turn
// markers, the channels, and the persistence that makes all of it survive a
// restart without ever notifying twice.
//
// Ordering rule worth stating once: the lastNotified marker is written
// *before* the sends. A crash between marker and send costs one missed
// notification; the other order costs a duplicate on every crash, forever,
// and a duplicate is the one behaviour the spec forbids outright.

import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type {
  GameTurnReporter,
  NotifyGameRegistration,
  TurnNotifier,
} from '@game-host/host/contract.js';
import type { EmailSender, NotifyChannels, PushSender, TurnPayload } from './channels.js';
import { PushSubscriptionGoneError } from './channels.js';
import { createKeyedJsonStore, type KeyedJsonStore } from './jsonStore.js';
import {
  isProfileRecord,
  isRoomRecord,
  PLAYER_KEY,
  type NotifyPrefs,
  type ProfileRecord,
  type PushSubscriptionRecord,
  type RoomRecord,
} from './records.js';

export interface NotifyServiceOptions {
  /** Absolute; the host allocates it beside the per-game save directories. */
  dataDir: string;
  /**
   * How long a player must stay disconnected after their turn starts before
   * anything is sent. Presence is re-checked when the timer fires, so a
   * shorter-than-window absence never notifies.
   */
  debounceMs?: number;
  /**
   * Absolute origin (e.g. https://games.example.com) for links in emails —
   * a mail client has no window.location to be relative to. Email is
   * disabled without it, loudly, at boot.
   */
  origin?: string;
  channels?: NotifyChannels;
  now?: () => number;
  log?: (line: string) => void;
}

export type EmailSubmitResult =
  | 'confirmationSent'
  | 'alreadyConfirmed'
  | 'rateLimited'
  | 'invalidAddress'
  | 'emailUnavailable';

export type ConfirmResult = 'confirmed' | 'expired' | 'invalid';

export interface SettingsView {
  pushEnabled: boolean;
  emailEnabled: boolean;
  vapidPublicKey: string | null;
  prefs: NotifyPrefs;
  pushEndpoints: string[];
  email: { address: string; status: string } | null;
}

export interface BindResult {
  ok: boolean;
  reason?: 'noSuchGame' | 'seatRefused';
}

/** The service, as the host and the HTTP router see it. Games see only TurnNotifier. */
export interface NotifyService extends TurnNotifier {
  bindSeat(
    playerKey: string,
    gameId: string,
    roomId: string,
    playerId: string,
    token: string,
  ): BindResult;
  settings(playerKey: string): SettingsView;
  addSubscription(playerKey: string, subscription: PushSubscriptionRecord): void;
  removeSubscription(playerKey: string, endpoint: string): void;
  setPrefs(playerKey: string, prefs: Partial<NotifyPrefs>): void;
  submitEmail(playerKey: string, address: string): Promise<EmailSubmitResult>;
  removeEmail(playerKey: string): void;
  confirmEmail(token: string): ConfirmResult;
  unsubscribeEmail(token: string): boolean;
  pushPublicKey(): string | null;
  emailEnabled(): boolean;
  /** Timers cleared, in-flight sends and saves drained. */
  close(): Promise<void>;
}

export const DEFAULT_DEBOUNCE_MS = 60_000;

export function isPlayerKey(value: unknown): value is string {
  return typeof value === 'string' && PLAYER_KEY.test(value);
}

/** The key never touches disk or memory beyond this digest. */
export function profileIdFor(playerKey: string): string {
  return createHash('sha256').update(playerKey).digest('hex');
}

// A real parser is overkill and a strict RFC regex rejects real addresses;
// this is the sane middle the spec asks for, backed by the confirmation
// loop — an address is never trusted until its owner clicks the link.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_SHAPE.test(value);
}

function utcDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function newToken(): string {
  return randomBytes(24).toString('base64url'); // 192 bits
}

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONFIRMATION_SENDS_PER_DAY = 3;
const GAME_ID = /^[a-z0-9-]{1,32}$/;
const ROOM_ID = /^[A-Za-z0-9-]{1,32}$/;

export async function createNotifyService(options: NotifyServiceOptions): Promise<NotifyService> {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const push: PushSender | null = options.channels?.push ?? null;
  const email: EmailSender | null = options.channels?.email ?? null;
  const origin = options.origin?.replace(/\/$/, '') ?? null;
  // A turn email carries links; without an origin they cannot be built, so
  // the channel is off rather than sending mail with broken buttons.
  const emailUsable = email !== null && origin !== null;

  const profileStore: KeyedJsonStore<ProfileRecord> = createKeyedJsonStore(
    join(options.dataDir, 'profiles'),
    isProfileRecord,
  );
  const roomStore: KeyedJsonStore<RoomRecord> = createKeyedJsonStore(
    join(options.dataDir, 'rooms'),
    isRoomRecord,
  );

  const profiles = new Map<string, ProfileRecord>();
  const rooms = new Map<string, RoomRecord>();
  {
    const loadedProfiles = await profileStore.loadAll();
    for (const record of loadedProfiles.records) profiles.set(record.profileId, record);
    const loadedRooms = await roomStore.loadAll();
    for (const record of loadedRooms.records) rooms.set(record.key, record);
    const unreadable = loadedProfiles.unreadable.length + loadedRooms.unreadable.length;
    if (unreadable > 0) log(`! Notify store: ${unreadable} unreadable record(s) skipped`);
  }

  const games = new Map<string, NotifyGameRegistration>();
  const pendingTimers = new Map<string, NodeJS.Timeout>();
  const inFlightSends = new Set<Promise<void>>();
  let closed = false;

  function saveProfile(profile: ProfileRecord): void {
    profile.savedAt = now();
    void profileStore.save(profile.profileId, profile);
  }

  function saveRoom(room: RoomRecord): void {
    room.savedAt = now();
    void roomStore.save(room.key, room);
  }

  function profileFor(playerKey: string): ProfileRecord {
    const profileId = profileIdFor(playerKey);
    let profile = profiles.get(profileId);
    if (!profile) {
      profile = { profileId, savedAt: now(), prefs: { push: true, email: true }, push: [] };
      profiles.set(profileId, profile);
    }
    return profile;
  }

  function roomKey(gameId: string, roomId: string): string {
    return `${gameId}--${roomId}`;
  }

  async function sendPush(profile: ProfileRecord, payload: TurnPayload): Promise<void> {
    if (!push || !profile.prefs.push || profile.push.length === 0) return;
    const dead: string[] = [];
    for (const subscription of profile.push) {
      try {
        await push.send(subscription, payload);
      } catch (error) {
        if (error instanceof PushSubscriptionGoneError) dead.push(subscription.endpoint);
        else log(`! Push send failed: ${String(error)}`);
      }
    }
    if (dead.length > 0) {
      profile.push = profile.push.filter((s) => !dead.includes(s.endpoint));
      saveProfile(profile);
    }
  }

  async function sendEmail(profile: ProfileRecord, payload: TurnPayload): Promise<void> {
    if (!email || !emailUsable || !profile.prefs.email) return;
    const record = profile.email;
    // Never an unconfirmed address — pending and disabled both stay silent.
    if (!record || record.status !== 'confirmed' || !record.unsubscribeToken) return;
    const roomUrl = `${origin ?? ''}${payload.url}`;
    const unsubscribeUrl = `${origin ?? ''}/notify/unsubscribe?token=${record.unsubscribeToken}`;
    try {
      await email.sendTurn(record.address, payload, roomUrl, unsubscribeUrl);
    } catch (error) {
      log(`! Turn email failed: ${String(error)}`);
    }
  }

  function fire(reg: NotifyGameRegistration, roomId: string, playerId: string, turnKey: string): void {
    if (closed) return;
    // Presence is checked now, at the end of the window, not at the turn
    // change — the whole point of the debounce.
    if (reg.isConnected(roomId, playerId)) return;
    const room = rooms.get(roomKey(reg.gameId, roomId));
    if (!room) return;
    if (room.lastNotified[playerId] === turnKey) return;
    const profileId = room.bindings[playerId];
    if (profileId === undefined) return;
    const profile = profiles.get(profileId);
    if (!profile) return;

    // Marker before sends — see the file comment for why this order.
    room.lastNotified[playerId] = turnKey;
    saveRoom(room);

    const payload: TurnPayload = {
      gameTitle: reg.title,
      roomId,
      url: reg.roomPath(roomId),
    };
    const send = Promise.allSettled([sendPush(profile, payload), sendEmail(profile, payload)]).then(
      () => undefined,
    );
    const tracked: Promise<void> = send.finally(() => {
      inFlightSends.delete(tracked);
    });
    inFlightSends.add(tracked);
  }

  return {
    registerGame(registration: NotifyGameRegistration): GameTurnReporter {
      if (!GAME_ID.test(registration.gameId)) {
        throw new Error(`Notify gameId must match ${String(GAME_ID)}: ${registration.gameId}`);
      }
      games.set(registration.gameId, registration);
      return {
        turnChanged: (roomId, currentPlayerId, turnKey) => {
          if (closed || !ROOM_ID.test(roomId)) return;
          const key = roomKey(registration.gameId, roomId);
          const timer = pendingTimers.get(key);
          if (timer) {
            clearTimeout(timer);
            pendingTimers.delete(key);
          }
          if (currentPlayerId === null) return;
          if (rooms.get(key)?.lastNotified[currentPlayerId] === turnKey) return;
          const next = setTimeout(() => {
            pendingTimers.delete(key);
            fire(registration, roomId, currentPlayerId, turnKey);
          }, debounceMs);
          next.unref();
          pendingTimers.set(key, next);
        },
        roomRemoved: (roomId) => {
          if (!ROOM_ID.test(roomId)) return;
          const key = roomKey(registration.gameId, roomId);
          const timer = pendingTimers.get(key);
          if (timer) {
            clearTimeout(timer);
            pendingTimers.delete(key);
          }
          if (rooms.delete(key)) void roomStore.remove(key);
        },
      };
    },

    bindSeat(playerKey, gameId, roomId, playerId, token): BindResult {
      const reg = games.get(gameId);
      if (!reg || !ROOM_ID.test(roomId)) return { ok: false, reason: 'noSuchGame' };
      if (!reg.verifySeat(roomId, playerId, token)) return { ok: false, reason: 'seatRefused' };
      const profile = profileFor(playerKey);
      saveProfile(profile);
      const key = roomKey(gameId, roomId);
      let room = rooms.get(key);
      if (!room) {
        room = { key, gameId, roomId, savedAt: now(), bindings: {}, lastNotified: {} };
        rooms.set(key, room);
      }
      room.bindings[playerId] = profile.profileId;
      saveRoom(room);
      return { ok: true };
    },

    settings(playerKey): SettingsView {
      const profile = profiles.get(profileIdFor(playerKey));
      return {
        pushEnabled: push !== null,
        emailEnabled: emailUsable,
        vapidPublicKey: push?.publicKey ?? null,
        prefs: profile?.prefs ?? { push: true, email: true },
        pushEndpoints: profile?.push.map((s) => s.endpoint) ?? [],
        email: profile?.email ? { address: profile.email.address, status: profile.email.status } : null,
      };
    },

    addSubscription(playerKey, subscription): void {
      const profile = profileFor(playerKey);
      profile.push = profile.push.filter((s) => s.endpoint !== subscription.endpoint);
      profile.push.push(subscription);
      saveProfile(profile);
    },

    removeSubscription(playerKey, endpoint): void {
      const profile = profiles.get(profileIdFor(playerKey));
      if (!profile) return;
      const before = profile.push.length;
      profile.push = profile.push.filter((s) => s.endpoint !== endpoint);
      if (profile.push.length !== before) saveProfile(profile);
    },

    setPrefs(playerKey, prefs): void {
      const profile = profileFor(playerKey);
      if (prefs.push !== undefined) profile.prefs.push = prefs.push;
      if (prefs.email !== undefined) profile.prefs.email = prefs.email;
      saveProfile(profile);
    },

    async submitEmail(playerKey, rawAddress): Promise<EmailSubmitResult> {
      if (!email || !emailUsable || origin === null) return 'emailUnavailable';
      const address = rawAddress.trim();
      if (!isValidEmailAddress(address)) return 'invalidAddress';
      const profile = profileFor(playerKey);
      const existing = profile.email;
      if (existing && existing.status === 'confirmed' && existing.address === address) {
        return 'alreadyConfirmed';
      }
      // Same address, same UTC day: count against the 3-a-day resend limit.
      // A different address starts its own count (and replaces the old one —
      // the spec leaves replaced-as-pending as implementer's choice).
      const day = utcDay(now());
      const sendCount =
        existing && existing.address === address && existing.sendDay === day
          ? (existing.sendCount ?? 0)
          : 0;
      if (sendCount >= MAX_CONFIRMATION_SENDS_PER_DAY) return 'rateLimited';
      const confirmToken = newToken();
      profile.email = {
        address,
        status: 'pending',
        confirmToken,
        confirmExpiry: now() + CONFIRM_TTL_MS,
        sendDay: day,
        sendCount: sendCount + 1,
      };
      saveProfile(profile);
      const confirmUrl = `${origin}/notify/confirm?token=${confirmToken}`;
      try {
        await email.sendConfirmation(address, confirmUrl);
      } catch (error) {
        log(`! Confirmation email failed: ${String(error)}`);
      }
      return 'confirmationSent';
    },

    removeEmail(playerKey): void {
      const profile = profiles.get(profileIdFor(playerKey));
      if (!profile?.email) return;
      delete profile.email;
      saveProfile(profile);
    },

    confirmEmail(token): ConfirmResult {
      if (typeof token !== 'string' || token.length < 16) return 'invalid';
      for (const profile of profiles.values()) {
        const record = profile.email;
        if (!record || record.status !== 'pending' || record.confirmToken !== token) continue;
        if (record.confirmExpiry !== undefined && now() > record.confirmExpiry) return 'expired';
        record.status = 'confirmed';
        delete record.confirmToken;
        delete record.confirmExpiry;
        record.unsubscribeToken = newToken();
        saveProfile(profile);
        return 'confirmed';
      }
      return 'invalid';
    },

    unsubscribeEmail(token): boolean {
      if (typeof token !== 'string' || token.length < 16) return false;
      for (const profile of profiles.values()) {
        const record = profile.email;
        if (!record || record.unsubscribeToken !== token) continue;
        record.status = 'disabled';
        saveProfile(profile);
        return true;
      }
      return false;
    },

    pushPublicKey(): string | null {
      return push?.publicKey ?? null;
    },

    emailEnabled(): boolean {
      return emailUsable;
    },

    async close(): Promise<void> {
      closed = true;
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
      while (inFlightSends.size > 0) await Promise.all([...inFlightSends]);
      await profileStore.settled();
      await roomStore.settled();
    },
  };
}
