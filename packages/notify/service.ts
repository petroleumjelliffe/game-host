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

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  GameTurnReporter,
  NotifyGameRegistration,
  TurnNotifier,
} from '@game-host/host/contract.js';
import type {
  EmailSender,
  InvitePayload,
  NotifyChannels,
  PushPayload,
  PushSender,
  TurnPayload,
} from './channels.js';
import { PushSubscriptionGoneError } from './channels.js';
import { createKeyedJsonStore, type KeyedJsonStore } from './jsonStore.js';
import {
  isInviteRecord,
  isProfileRecord,
  isRoomRecord,
  MAX_CONTACTS,
  MAX_PROFILE_NAME_LENGTH,
  normalizeBindings,
  PLAYER_KEY,
  type ContactRecord,
  type InviteRecord,
  type InviteTarget,
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

export interface BindOptions {
  /** Display name from the room identity; stamps the profile, last-writer-wins. */
  name?: string;
  /**
   * Where the binder is. Lobby binds register the seat binding only (they
   * feed `alreadySeated` and invite fan-out); the co-player ledger writes
   * only on `playing` binds — the ledger records people you actually played
   * with, not people who looked into a lobby. Client-reported, and only
   * able to distort the reporter's own ledger timing, which is the same
   * trust level as the bind itself. Defaults to `playing`: clients built
   * before the field existed bind exactly then.
   */
  phase?: 'lobby' | 'playing';
}

/** One contact row, as the wire sees it: no address, no profileId, ever. */
export interface ContactView {
  contactId: string;
  name: string;
  lastPlayedAt: number;
  /** Live registration title, falling back to the bare gameId when unmounted. */
  gameTitle: string;
  /** One boolean forever — never *which* channel reaches them. */
  reachable: boolean;
  /** Present only when the caller gave room context. Advisory: an unbound player reads as absent. */
  alreadySeated?: boolean;
}

export interface InviteRequest {
  playerKey: string;
  gameId: string;
  roomId: string;
  /** The inviter's own seat — proof, via verifySeat, that they are in the room. */
  playerId: string;
  token: string;
  /** Exactly one of these: the parent spec's shape, or the friends spec's. */
  email?: string;
  contactId?: string;
}

export type InviteRefusal =
  | 'noSuchGame'
  | 'seatRefused'
  | 'invalidAddress'
  | 'emailUnavailable'
  /** Foreign and fabricated contactIds answer identically — the non-probe rule. */
  | 'noSuchContact'
  | 'blocked'
  | 'unreachable'
  | 'alreadySeated'
  | 'rateLimited'
  | 'roomFull';

export type InviteResult =
  | { ok: true; playerId: string; resend: boolean }
  | { ok: false; reason: InviteRefusal };

export interface RemindRequest {
  playerKey: string;
  gameId: string;
  roomId: string;
  /** The reminder's own seat — proof, via verifySeat, that they are in the room. */
  playerId: string;
  token: string;
  /** The pending seat whose invite to resend. */
  targetPlayerId: string;
}

/** What a claim or key redemption hands the landing page: a whole identity. */
export interface SeatCredentials {
  playerId: string;
  token: string;
  name: string;
}

/** The service, as the host and the HTTP router see it. Games see only TurnNotifier. */
export interface NotifyService extends TurnNotifier {
  bindSeat(
    playerKey: string,
    gameId: string,
    roomId: string,
    playerId: string,
    token: string,
    opts?: BindOptions,
  ): BindResult;
  /** The caller's own ledger, read out safely. Room context adds alreadySeated. */
  contacts(playerKey: string, room?: { gameId: string; roomId: string }): ContactView[];
  /** Reserve a seat and deliver the invite — or resend a live one. */
  invite(request: InviteRequest): Promise<InviteResult>;
  /**
   * The reserved row's Remind: resend the live invite for a pending seat,
   * addressed by the seat rather than the target — after a reload the
   * inviter's client knows only the roster's pending row, never who is
   * behind it (that is the privacy stance working). Same caps, same link.
   */
  remind(request: RemindRequest): Promise<InviteResult>;
  /** One shaped null for every failure: unknown, revoked, already claimed, dead room. */
  claimInvite(
    inviteToken: string,
    playerKey?: string,
  ): (SeatCredentials & { inviterName: string | null }) | null;
  /** Redeem an emailed seat key. Same single refusal shape. */
  redeemSeatKey(key: string): SeatCredentials | null;
  /**
   * Run the 24h reminder sweep now and hourly after. Called by the host
   * AFTER every game has mounted — the service is created before any game
   * registers, and a sweep with no registrations could resolve no title,
   * path, or presence check. Rooms whose game is unregistered are skipped,
   * never dropped: absent this boot is not gone.
   */
  startReminderSweep(): void;
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

// Invite caps, indicative numbers per the friends spec: the per-target cap
// is the recipient's protection against a resend loop, the per-inviter cap
// bounds a spray, and an emailed address rides its own daily count because
// an invited address has no profile to carry the confirmation counter.
const MAX_INVITES_PER_TARGET_PER_DAY = 3;
const MAX_INVITES_PER_INVITER_PER_DAY = 20;
const MAX_INVITES_PER_ADDRESS_PER_DAY = 3;
const REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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
  const inviteStore: KeyedJsonStore<InviteRecord> = createKeyedJsonStore(
    join(options.dataDir, 'invites'),
    isInviteRecord,
  );

  const profiles = new Map<string, ProfileRecord>();
  const rooms = new Map<string, RoomRecord>();
  const invites = new Map<string, InviteRecord>();
  {
    const loadedProfiles = await profileStore.loadAll();
    for (const record of loadedProfiles.records) profiles.set(record.profileId, record);
    const loadedRooms = await roomStore.loadAll();
    // Normalization HERE, not in the guard: a guard is a predicate with no
    // return channel, and a legacy scalar binding put through the fan-out
    // loop would iterate as 64 one-character "profileIds" — every
    // notification for every pre-migration room silently dropped.
    for (const record of loadedRooms.records) rooms.set(record.key, normalizeBindings(record));
    const loadedInvites = await inviteStore.loadAll();
    for (const record of loadedInvites.records) invites.set(record.tokenHash, record);
    const unreadable =
      loadedProfiles.unreadable.length +
      loadedRooms.unreadable.length +
      loadedInvites.unreadable.length;
    if (unreadable > 0) log(`! Notify store: ${unreadable} unreadable record(s) skipped`);
  }

  // The seat-key secret: seat keys are derived, never stored —
  // HMAC(secret, game/room/seat/seat-token) — so every email about a seat
  // carries the same key while its token stands, and an honor-system
  // reclaim (which rotates the token) rotates the key with no bookkeeping.
  // The secret persists so a restart keeps every emailed link alive.
  const secretPath = join(options.dataDir, 'seat-key-secret');
  const seatKeySecret = await (async () => {
    try {
      const existing = (await readFile(secretPath, 'utf8')).trim();
      if (existing.length >= 32) return existing;
    } catch {
      // First boot: mint below.
    }
    const minted = randomBytes(32).toString('base64url');
    await mkdir(options.dataDir, { recursive: true });
    await writeFile(secretPath, minted, { mode: 0o600 });
    return minted;
  })();

  const games = new Map<string, NotifyGameRegistration>();
  const pendingTimers = new Map<string, NodeJS.Timeout>();
  const inFlightSends = new Set<Promise<void>>();
  let reminderTimer: NodeJS.Timeout | null = null;
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

  function saveInvite(record: InviteRecord): void {
    void inviteStore.save(record.tokenHash, record);
  }

  function track(send: Promise<void>): void {
    const tracked: Promise<void> = send.finally(() => {
      inFlightSends.delete(tracked);
    });
    inFlightSends.add(tracked);
  }

  function seatKeyFor(gameId: string, roomId: string, playerId: string, seatToken: string): string {
    return createHmac('sha256', seatKeySecret)
      .update(`${gameId}\n${roomId}\n${playerId}\n${seatToken}`)
      .digest('base64url');
  }

  /** The seat's emailed deep link: the room path plus its `?key=`, when derivable. */
  function seatEmailUrl(reg: NotifyGameRegistration, roomId: string, playerId: string): string {
    const base = reg.roomPath(roomId);
    const creds = reg.getSeatCredentials?.(roomId, playerId);
    if (!creds) return base;
    return `${base}?key=${seatKeyFor(reg.gameId, roomId, playerId, creds.token)}`;
  }

  /** Any enabled channel across this profile, prefs respected. */
  function reachableProfile(profile: ProfileRecord | undefined): boolean {
    if (!profile) return false;
    if (push !== null && profile.prefs.push && profile.push.length > 0) return true;
    return emailUsable && profile.prefs.email && profile.email?.status === 'confirmed';
  }

  function seatedIn(room: RoomRecord, profileIds: readonly string[]): boolean {
    return Object.values(room.bindings).some((bound) =>
      bound.some((id) => profileIds.includes(id)),
    );
  }

  /** True when the profile was newly added to the seat's binding set. */
  function addBinding(room: RoomRecord, playerId: string, profileId: string): boolean {
    const bound = (room.bindings[playerId] ??= []);
    if (bound.includes(profileId)) return false;
    bound.push(profileId);
    return true;
  }

  async function sendPush(profile: ProfileRecord, payload: PushPayload): Promise<void> {
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

  /** Whether a turn/reminder email would actually go to this profile. */
  function emailEligible(profile: ProfileRecord): boolean {
    return (
      email !== null &&
      emailUsable &&
      profile.prefs.email &&
      profile.email?.status === 'confirmed' &&
      profile.email.unsubscribeToken !== undefined
    );
  }

  async function sendEmail(
    profile: ProfileRecord,
    payload: TurnPayload,
    roomUrl: string,
    kind: 'turn' | 'reminder',
  ): Promise<void> {
    // Never an unconfirmed address — pending and disabled both stay silent.
    if (!email || !emailEligible(profile)) return;
    const record = profile.email!;
    const unsubscribeUrl = `${origin ?? ''}/notify/unsubscribe?token=${record.unsubscribeToken}`;
    try {
      if (kind === 'reminder') {
        await email.sendTurnReminder(record.address, payload, roomUrl, unsubscribeUrl);
      } else {
        await email.sendTurn(record.address, payload, roomUrl, unsubscribeUrl);
      }
    } catch (error) {
      log(`! Turn email failed: ${String(error)}`);
    }
  }

  /**
   * The fan-out (parent spec §5 finishing what bindSeat started): every
   * profile bound to the seat, email deduped by address across profiles —
   * two profiles confirmed at one address are one person getting one mail.
   */
  async function sendToSeat(
    targets: ProfileRecord[],
    payload: TurnPayload,
    emailUrl: string,
    kind: 'turn' | 'reminder',
  ): Promise<void> {
    const mailed = new Set<string>();
    const jobs: Promise<void>[] = [];
    for (const profile of targets) {
      jobs.push(sendPush(profile, payload));
      if (emailEligible(profile)) {
        const address = profile.email!.address.toLowerCase();
        if (!mailed.has(address)) {
          mailed.add(address);
          jobs.push(sendEmail(profile, payload, emailUrl, kind));
        }
      }
    }
    await Promise.allSettled(jobs);
  }

  function fire(reg: NotifyGameRegistration, roomId: string, playerId: string, turnKey: string): void {
    if (closed) return;
    // Presence is checked now, at the end of the window, not at the turn
    // change — the whole point of the debounce.
    if (reg.isConnected(roomId, playerId)) return;
    const room = rooms.get(roomKey(reg.gameId, roomId));
    if (!room) return;
    if (room.lastNotified[playerId] === turnKey) return;
    const targets = (room.bindings[playerId] ?? [])
      .map((id) => profiles.get(id))
      .filter((p): p is ProfileRecord => p !== undefined);
    if (targets.length === 0) return;

    // Markers before sends — see the file comment for why this order. The
    // currentTurn marker is the 24h reminder's anchor; turnChanged clears
    // it the moment a newer turn supersedes it.
    room.lastNotified[playerId] = turnKey;
    room.currentTurn = { playerId, turnKey, notifiedAt: now() };
    saveRoom(room);

    const payload: TurnPayload = {
      gameTitle: reg.title,
      roomId,
      url: reg.roomPath(roomId),
    };
    // The emailed link carries the seat key — every email is a login link.
    const emailUrl = `${origin ?? ''}${seatEmailUrl(reg, roomId, playerId)}`;
    track(sendToSeat(targets, payload, emailUrl, 'turn'));
  }

  function sweepReminders(): void {
    if (closed) return;
    for (const room of rooms.values()) {
      const marker = room.currentTurn;
      if (!marker || marker.remindedAt !== undefined) continue;
      if (now() - marker.notifiedAt < REMINDER_DELAY_MS) continue;
      const reg = games.get(room.gameId);
      // Unregistered is skipped, never dropped: a game absent this boot may
      // be back the next, and its rooms are not ours to forget.
      if (!reg) continue;
      if (reg.isConnected(room.roomId, marker.playerId)) continue;
      const targets = (room.bindings[marker.playerId] ?? [])
        .map((id) => profiles.get(id))
        .filter((p): p is ProfileRecord => p !== undefined);
      if (targets.length === 0) continue;

      // Marker before send, same crash discipline as lastNotified: one
      // reminder per turn, and a crash mid-send misses rather than doubles.
      marker.remindedAt = now();
      saveRoom(room);

      const payload: TurnPayload = {
        gameTitle: reg.title,
        roomId: room.roomId,
        url: reg.roomPath(room.roomId),
      };
      const emailUrl = `${origin ?? ''}${seatEmailUrl(reg, room.roomId, marker.playerId)}`;
      track(sendToSeat(targets, payload, emailUrl, 'reminder'));
    }
  }

  /** Delivery for invites: immediate — no debounce, no presence check. */
  async function deliverInvite(
    reg: NotifyGameRegistration,
    record: InviteRecord,
    inviterName: string | null,
  ): Promise<void> {
    const payload: InvitePayload = {
      kind: 'invite',
      gameTitle: reg.title,
      roomId: record.roomId,
      url: `${reg.roomPath(record.roomId)}?invite=${record.token}`,
      inviterName,
    };
    const roomUrl = `${origin ?? ''}${payload.url}`;
    if (record.target.kind === 'email') {
      if (!email || !emailUsable) return;
      try {
        // First contact: no unsubscribe token exists yet (claiming is what
        // confirms the address and mints one), so no link — the mail says
        // "ignore this and nothing more will be sent" instead.
        await email.sendInvite(record.target.address, payload, roomUrl);
      } catch (error) {
        log(`! Invite email failed: ${String(error)}`);
      }
      return;
    }
    const mailed = new Set<string>();
    const jobs: Promise<void>[] = [];
    for (const profileId of record.target.profileIds) {
      const profile = profiles.get(profileId);
      if (!profile) continue;
      jobs.push(sendPush(profile, payload));
      if (email && emailEligible(profile)) {
        const address = profile.email!.address.toLowerCase();
        if (!mailed.has(address)) {
          mailed.add(address);
          const unsubscribeUrl = `${origin ?? ''}/notify/unsubscribe?token=${profile.email!.unsubscribeToken}`;
          jobs.push(
            email.sendInvite(profile.email!.address, payload, roomUrl, unsubscribeUrl).catch(
              (error: unknown) => {
                log(`! Invite email failed: ${String(error)}`);
              },
            ),
          );
        }
      }
    }
    await Promise.allSettled(jobs);
  }

  /**
   * The reciprocal ledger write, at a playing bind (friends spec §2): for
   * the binder's seat and every *other* bound seat, both directions. Same-
   * seat profiles never pair — your own phone must not appear in your
   * friend list — and a profile never contacts itself across seats.
   */
  function updateLedgerEntry(
    owner: ProfileRecord,
    themIds: readonly string[],
    theirName: string,
    room: RoomRecord,
  ): void {
    if (themIds.includes(owner.profileId)) return;
    const contacts = (owner.contacts ??= []);
    const entry = contacts.find((c) => c.profileIds.some((id) => themIds.includes(id)));
    let changed = false;
    if (!entry) {
      const created: ContactRecord = {
        contactId: newToken(),
        profileIds: [...themIds],
        name: theirName,
        gameId: room.gameId,
        lastRoom: room.key,
        lastPlayedAt: now(),
        status: 'played',
      };
      contacts.push(created);
      // "People I might invite", not an archive: oldest-played evicted.
      if (contacts.length > MAX_CONTACTS) {
        contacts.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
        contacts.length = MAX_CONTACTS;
      }
      changed = true;
    } else {
      for (const id of themIds) {
        if (!entry.profileIds.includes(id)) {
          entry.profileIds.push(id);
          changed = true;
        }
      }
      if (theirName !== '' && entry.name !== theirName) {
        entry.name = theirName;
        changed = true;
      }
      // lastPlayedAt bumps only when lastRoom does: one game together is
      // one write per pair, however many refreshes it takes.
      if (entry.lastRoom !== room.key) {
        entry.lastRoom = room.key;
        entry.gameId = room.gameId;
        entry.lastPlayedAt = now();
        changed = true;
      }
    }
    if (changed) saveProfile(owner);
  }

  function namedAmong(profileIds: readonly string[]): string {
    for (const id of profileIds) {
      const name = profiles.get(id)?.name;
      if (name) return name;
    }
    return 'Player';
  }

  function writeLedger(room: RoomRecord, seatId: string): void {
    const meIds = room.bindings[seatId] ?? [];
    if (meIds.length === 0) return;
    const myName = namedAmong(meIds);
    for (const [otherSeat, themIds] of Object.entries(room.bindings)) {
      if (otherSeat === seatId || themIds.length === 0) continue;
      const theirName = namedAmong(themIds);
      for (const mid of meIds) {
        const mine = profiles.get(mid);
        if (mine) updateLedgerEntry(mine, themIds, theirName, room);
      }
      for (const tid of themIds) {
        const theirs = profiles.get(tid);
        if (theirs) updateLedgerEntry(theirs, meIds, myName, room);
      }
    }
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
          // A superseded currentTurn dies here, persisted — without this, a
          // turn whose notification was *skipped* (player present at fire
          // time) would leave the previous turn's marker standing, and the
          // 24h sweep would remind for a turn already taken.
          const room = rooms.get(key);
          if (
            room?.currentTurn !== undefined &&
            (currentPlayerId === null || room.currentTurn.turnKey !== turnKey)
          ) {
            delete room.currentTurn;
            saveRoom(room);
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
        seatVacated: (roomId, playerId) => {
          if (!ROOM_ID.test(roomId)) return;
          const key = roomKey(registration.gameId, roomId);
          const room = rooms.get(key);
          // Seat ids are reused: a stale binding would union strangers into
          // one seat's set and fan their notifications out to each other.
          if (room && room.bindings[playerId] !== undefined) {
            delete room.bindings[playerId];
            saveRoom(room);
          }
          // Dead invites refuse claims and never resend — a re-invite after
          // revoke reserves fresh instead of re-mailing a dead token.
          for (const record of invites.values()) {
            if (
              record.gameId === registration.gameId &&
              record.roomId === roomId &&
              record.playerId === playerId &&
              record.claimedAt === undefined &&
              record.revokedAt === undefined
            ) {
              record.revokedAt = now();
              saveInvite(record);
            }
          }
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
          for (const [hash, record] of invites) {
            if (record.gameId === registration.gameId && record.roomId === roomId) {
              invites.delete(hash);
              void inviteStore.remove(hash);
            }
          }
        },
      };
    },

    bindSeat(playerKey, gameId, roomId, playerId, token, opts = {}): BindResult {
      const reg = games.get(gameId);
      if (!reg || !ROOM_ID.test(roomId)) return { ok: false, reason: 'noSuchGame' };
      if (!reg.verifySeat(roomId, playerId, token)) return { ok: false, reason: 'seatRefused' };
      const existed = profiles.has(profileIdFor(playerKey));
      const profile = profileFor(playerKey);
      // The display name, stamped from the room identity the bind hook
      // already holds. Last-writer-wins; a rename propagates next bind.
      const name = opts.name?.trim().slice(0, MAX_PROFILE_NAME_LENGTH);
      const renamed = name !== undefined && name !== '' && name !== profile.name;
      if (renamed) profile.name = name;
      if (!existed || renamed) saveProfile(profile);
      const key = roomKey(gameId, roomId);
      let room = rooms.get(key);
      if (!room) {
        room = { key, gameId, roomId, savedAt: now(), bindings: {}, lastNotified: {} };
        rooms.set(key, room);
      }
      // A set, appended to — two devices on one seat are two profiles and
      // one person; the send loop fans out over all of them. Saved only on
      // change: the bind hook is fire-and-forget on every mount, and a
      // six-player room refreshing must not rewrite six records per refresh.
      const grew = addBinding(room, playerId, profile.profileId);
      if (grew) saveRoom(room);
      // Ledger writes only at play phase: the ledger records people you
      // actually played with, not people who looked into a lobby. A lobby
      // claim's bind lands here as 'lobby' and writes nothing; the play-
      // phase bind minutes later does.
      if ((opts.phase ?? 'playing') === 'playing') writeLedger(room, playerId);
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

    contacts(playerKey, roomCtx): ContactView[] {
      const profile = profiles.get(profileIdFor(playerKey));
      const entries = profile?.contacts ?? [];
      const room =
        roomCtx !== undefined ? rooms.get(roomKey(roomCtx.gameId, roomCtx.roomId)) : undefined;
      return entries
        .slice()
        .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
        .map((entry) => ({
          contactId: entry.contactId,
          name: entry.name,
          lastPlayedAt: entry.lastPlayedAt,
          gameTitle: games.get(entry.gameId)?.title ?? entry.gameId,
          reachable: entry.profileIds.some((id) => reachableProfile(profiles.get(id))),
          // Advisory: computed from lobby-phase bindings, so a player whose
          // storage is blocked (or who closed the tab before binding) reads
          // as invitable; the invite then reserves a seat revoke can free.
          ...(room !== undefined ? { alreadySeated: seatedIn(room, entry.profileIds) } : {}),
        }));
    },

    async invite(request): Promise<InviteResult> {
      const reg = games.get(request.gameId);
      // A game without the capabilities cannot host invites: same shape as
      // an unknown game, deliberately.
      if (
        !reg ||
        !ROOM_ID.test(request.roomId) ||
        reg.reserveSeat === undefined ||
        reg.claimSeat === undefined
      ) {
        return { ok: false, reason: 'noSuchGame' };
      }
      // The inviter proves their own seat. Host-only is a UI stance; any
      // verified seat may invite — the structural defense is that by name
      // you can only invite people who chose to sit at a table with you.
      if (!reg.verifySeat(request.roomId, request.playerId, request.token)) {
        return { ok: false, reason: 'seatRefused' };
      }
      const inviter = profileFor(request.playerKey);

      // Resolve the target — every refusal here lands BEFORE any seat is
      // reserved, so nothing dangles.
      let target: InviteTarget;
      let seatName: string | null = null;
      if (request.contactId !== undefined) {
        const entry = inviter.contacts?.find((c) => c.contactId === request.contactId);
        // Foreign and fabricated ids answer identically: a contactId only
        // ever resolves within the caller's own ledger.
        if (!entry) return { ok: false, reason: 'noSuchContact' };
        if (entry.status === 'blocked') return { ok: false, reason: 'blocked' };
        if (!entry.profileIds.some((id) => reachableProfile(profiles.get(id)))) {
          return { ok: false, reason: 'unreachable' };
        }
        const room = rooms.get(roomKey(request.gameId, request.roomId));
        if (room && seatedIn(room, entry.profileIds)) {
          return { ok: false, reason: 'alreadySeated' };
        }
        target = { kind: 'profile', profileIds: [...entry.profileIds] };
        seatName = entry.name === '' ? null : entry.name;
      } else {
        if (!emailUsable) return { ok: false, reason: 'emailUnavailable' };
        const address = (request.email ?? '').trim();
        if (!isValidEmailAddress(address)) return { ok: false, reason: 'invalidAddress' };
        target = { kind: 'email', address };
      }

      const sameTarget = (recorded: InviteTarget): boolean => {
        if (recorded.kind === 'email' && target.kind === 'email') {
          return recorded.address.toLowerCase() === target.address.toLowerCase();
        }
        if (recorded.kind === 'profile' && target.kind === 'profile') {
          return recorded.profileIds.some((id) => target.profileIds.includes(id));
        }
        return false;
      };

      // The caps, counted across invite records the way the confirmation
      // cap counts: sendDay/sendCount reset per record on a new UTC day.
      const day = utcDay(now());
      const sentToday = (pred: (r: InviteRecord) => boolean): number => {
        let total = 0;
        for (const r of invites.values()) {
          if (r.sendDay === day && pred(r)) total += r.sendCount ?? 0;
        }
        return total;
      };
      const inviterId = inviter.profileId;
      if (
        sentToday((r) => r.inviterProfileId === inviterId && sameTarget(r.target)) >=
          MAX_INVITES_PER_TARGET_PER_DAY ||
        sentToday((r) => r.inviterProfileId === inviterId) >= MAX_INVITES_PER_INVITER_PER_DAY ||
        (target.kind === 'email' && sentToday((r) => sameTarget(r.target)) >= MAX_INVITES_PER_ADDRESS_PER_DAY)
      ) {
        return { ok: false, reason: 'rateLimited' };
      }

      // A live invite for this (room, target) makes this a RESEND — the
      // Remind button's whole mechanism: same link, same seat, never a
      // second reservation. Revoked and claimed records don't count, so a
      // revoke-then-reinvite reserves fresh.
      const existing = [...invites.values()].find(
        (r) =>
          r.gameId === request.gameId &&
          r.roomId === request.roomId &&
          r.claimedAt === undefined &&
          r.revokedAt === undefined &&
          sameTarget(r.target),
      );
      if (existing) {
        existing.sendCount = existing.sendDay === day ? (existing.sendCount ?? 0) + 1 : 1;
        existing.sendDay = day;
        saveInvite(existing);
        track(deliverInvite(reg, existing, inviter.name ?? null));
        return { ok: true, playerId: existing.playerId, resend: true };
      }

      const token = newToken();
      const tokenHash = sha256hex(token);
      const playerId = reg.reserveSeat(request.roomId, tokenHash, seatName);
      if (playerId === null) return { ok: false, reason: 'roomFull' };
      const record: InviteRecord = {
        tokenHash,
        token,
        target,
        gameId: request.gameId,
        roomId: request.roomId,
        playerId,
        inviterProfileId: inviterId,
        createdAt: now(),
        sendDay: day,
        sendCount: 1,
      };
      invites.set(tokenHash, record);
      saveInvite(record);
      track(deliverInvite(reg, record, inviter.name ?? null));
      return { ok: true, playerId, resend: false };
    },

    async remind(request): Promise<InviteResult> {
      const reg = games.get(request.gameId);
      if (!reg || !ROOM_ID.test(request.roomId)) return { ok: false, reason: 'noSuchGame' };
      if (!reg.verifySeat(request.roomId, request.playerId, request.token)) {
        return { ok: false, reason: 'seatRefused' };
      }
      // Addressed by seat: the live (unclaimed, unrevoked) invite behind
      // the pending row. A revoked or claimed seat has nothing to remind —
      // the same shape as a seat that never had an invite.
      const record = [...invites.values()].find(
        (r) =>
          r.gameId === request.gameId &&
          r.roomId === request.roomId &&
          r.playerId === request.targetPlayerId &&
          r.claimedAt === undefined &&
          r.revokedAt === undefined,
      );
      if (!record) return { ok: false, reason: 'noSuchContact' };
      // The recipient's protection: the same per-record daily cap the
      // invite path counts, whoever presses the button.
      const day = utcDay(now());
      const sentToday = record.sendDay === day ? (record.sendCount ?? 0) : 0;
      if (sentToday >= MAX_INVITES_PER_TARGET_PER_DAY) return { ok: false, reason: 'rateLimited' };
      record.sendCount = sentToday + 1;
      record.sendDay = day;
      saveInvite(record);
      const reminderName = profiles.get(profileIdFor(request.playerKey))?.name ?? null;
      track(deliverInvite(reg, record, reminderName));
      return { ok: true, playerId: record.playerId, resend: true };
    },

    claimInvite(inviteToken, playerKey) {
      if (typeof inviteToken !== 'string' || inviteToken.length < 16) return null;
      const record = invites.get(sha256hex(inviteToken));
      // One shaped null: unknown, revoked, already claimed, dead room.
      if (!record || record.claimedAt !== undefined || record.revokedAt !== undefined) return null;
      const reg = games.get(record.gameId);
      const creds = reg?.claimSeat?.(record.roomId, record.tokenHash) ?? null;
      if (!creds) return null;
      record.claimedAt = now();
      saveInvite(record);
      if (playerKey !== undefined && isPlayerKey(playerKey)) {
        const profile = profileFor(playerKey);
        // For an email invite, claiming IS the double-opt-in: at least as
        // strong a consent signal as a confirm click. Never clobbers an
        // address the profile already carries.
        if (
          record.target.kind === 'email' &&
          (profile.email === undefined || profile.email.address === record.target.address)
        ) {
          profile.email = {
            address: record.target.address,
            status: 'confirmed',
            unsubscribeToken: profile.email?.unsubscribeToken ?? newToken(),
          };
        }
        saveProfile(profile);
        // Bind the claiming device — lobby phase: the ledger waits for the
        // game to start.
        const key = roomKey(record.gameId, record.roomId);
        let room = rooms.get(key);
        if (!room) {
          room = {
            key,
            gameId: record.gameId,
            roomId: record.roomId,
            savedAt: now(),
            bindings: {},
            lastNotified: {},
          };
          rooms.set(key, room);
        }
        if (addBinding(room, creds.playerId, profile.profileId)) saveRoom(room);
      }
      // Who saved the seat, for the landing's greeting — a name the invite
      // already showed, never anything more.
      return { ...creds, inviterName: profiles.get(record.inviterProfileId)?.name ?? null };
    },

    redeemSeatKey(key): SeatCredentials | null {
      if (typeof key !== 'string' || key.length < 16 || key.length > 128) return null;
      // No key is stored anywhere, so redemption is recomputation: for each
      // bound seat, derive what its key would be and compare. Bounded by
      // live rooms × bound seats; each check is one map lookup, one read
      // from the game, one HMAC. A rotated seat token (honor-system
      // reclaim) simply never matches — old emails' links die, and the next
      // email carries the re-derived key: rotation, not permanent death.
      for (const room of rooms.values()) {
        const reg = games.get(room.gameId);
        if (!reg?.getSeatCredentials) continue;
        for (const playerId of Object.keys(room.bindings)) {
          const creds = reg.getSeatCredentials(room.roomId, playerId);
          if (!creds) continue;
          if (seatKeyFor(room.gameId, room.roomId, playerId, creds.token) === key) return creds;
        }
      }
      return null;
    },

    startReminderSweep(): void {
      if (closed || reminderTimer !== null) return;
      sweepReminders();
      reminderTimer = setInterval(sweepReminders, REMINDER_SWEEP_INTERVAL_MS);
      reminderTimer.unref();
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
      if (reminderTimer !== null) {
        clearInterval(reminderTimer);
        reminderTimer = null;
      }
      while (inFlightSends.size > 0) await Promise.all([...inFlightSends]);
      await profileStore.settled();
      await roomStore.settled();
      await inviteStore.settled();
    },
  };
}
