import type { LobbyView } from '../../../vendor/lobby/client/view';
import { SEATS } from '../../state/events';
import { SEAT_COLORS } from '../../game/tokens';
import { padRows, type Row, type ScreenDef } from '../types';

/**
 * Boards 1d, 1f and the terminals.
 *
 * The row *structure* here follows `lobbyView`'s inventory and the seven-row
 * invariant, and is fixed. The exact copy — labels and status text — is an
 * owner input from the Rail Baron Game Board Design project (Multiplayer
 * Screens, boards 1d–1f) and has NOT been checked against it: what is written
 * below follows the house voice of the screens beside it, and should be
 * reconciled with the approved boards before this is called done.
 */

/** The lobby's seat ids are the game's colours, so the chip is a lookup. */
const chipFor = (id: string | null): string | null => {
  const seat = SEATS.find((s) => s === id);
  return seat === undefined ? null : SEAT_COLORS[seat];
};

const BEGIN_BLOCKED: Record<NonNullable<LobbyView['beginBlocked']>, string> = {
  notHost: 'Host starts',
  notEnoughPlayers: 'Need 2 barons',
  alreadyBegun: 'Under way',
};

const CONNECTION: Record<LobbyView['connection'], string> = {
  connecting: 'Connecting',
  live: 'Live',
  dropped: 'Reconnecting',
};

/**
 * Board 1d: the room, its seats, and the way into the game.
 *
 * `note` is a refusal to show *in* the lobby — "only the host may begin",
 * a rename the server wouldn't take. The lobby hook deliberately ranks the
 * roster above such messages so a seated player is never thrown back to a
 * join form; the price of that ranking is that the message reaches nobody
 * unless a screen carries it, and this board is that screen. Failure on this
 * wire is opt-in — every channel left unread is a refusal shown to no one.
 */
export function onlineLobby(view: LobbyView, note: string | null = null): ScreenDef {
  const seats: Row[] = view.seats.map((seat) => {
    if (seat.id === null) {
      return {
        label: `Seat ${seat.index + 1}`,
        status: 'Open',
        text: 'OPEN',
        amount: '', showDollar: false,
        right: '',
        chip: null,
        tone: 'dim',
        action: null,
      } satisfies Row;
    }
    return {
      label: `Seat ${seat.index + 1}`,
      // Away rather than gone: a dropped player keeps their seat and the game
      // waits for them, which is what the roster's `connected` means.
      status: seat.connected ? (seat.isHost ? 'Host' : 'Ready') : 'Away',
      text: seat.name ?? '',
      amount: '', showDollar: false,
      right: seat.canRename ? 'Tap to edit' : (seat.isYou ? 'You' : ''),
      chip: chipFor(seat.id),
      tone: seat.connected ? 'normal' : 'dim',
      action: seat.canRename && seat.id !== null
        ? { kind: 'edit', field: `seat:${SEATS.find((s) => s === seat.id)!}`,
            placeholder: 'Type a name, press Enter' }
        : null,
    } satisfies Row;
  });

  // Six seats and seven rows leaves one, so the room code shares the departure
  // row: the code lives in `right` with the share action on it, and the
  // begin/blocked state is the row itself.
  const departure: Row = {
    label: '',
    status: view.canBegin ? 'Ready' : (view.beginBlocked ? BEGIN_BLOCKED[view.beginBlocked] : 'Waiting'),
    text: view.canBegin ? 'DEPART' : 'WAITING FOR BARONS',
    amount: '', showDollar: false,
    right: view.code,
    chip: null,
    tone: view.canBegin ? 'normal' : 'dim',
    action: view.canBegin ? { kind: 'begin' } : { kind: 'share' },
  };

  return {
    title: 'Online',
    // The room code survives a refusal — it is the one thing a player might
    // need to read out loud at any moment.
    sub: `ROOM ${view.code} · ${(note ?? CONNECTION[view.connection]).toUpperCase()}`,
    back: 'home',
    cols: ['Seat', 'State', 'Player name', '', 'Action'],
    rows: padRows([...seats, departure]),
  };
}

/**
 * Board 1f: type a code, or open a room of your own.
 *
 * `note` is how a refusal becomes visible. Opening a room is the one action
 * here that talks to the server, and every way it can fail — no server
 * listening, a server speaking a different protocol — arrives as a rejection
 * or as nothing at all. Without somewhere to say so, the row is tapped and the
 * screen simply sits there.
 */
export function joinRoom(code: string, note: string | null = null): ScreenDef {
  const ready = code.length === 6;
  return {
    title: 'Online',
    sub: note === null ? 'JOIN A ROOM' : note.toUpperCase(),
    back: 'home',
    cols: ['', 'State', 'Room', '', 'Action'],
    rows: padRows([
      {
        label: 'Code',
        status: ready ? 'Ready' : 'Six letters',
        text: code === '' ? 'TAP TO TYPE' : code,
        amount: '', showDollar: false,
        right: 'Tap to edit',
        chip: null,
        tone: code === '' ? 'dim' : 'normal',
        action: { kind: 'edit', field: 'roomCode', placeholder: 'Room code, press Enter' },
      },
      {
        label: '',
        status: ready ? 'Ready' : 'Waiting',
        text: 'JOIN ROOM',
        amount: '', showDollar: false,
        right: ready ? 'Takes a seat' : 'Need a code',
        chip: null,
        tone: ready ? 'normal' : 'disabled',
        action: ready ? { kind: 'joinRoom' } : null,
      },
      {
        label: '',
        status: note === null ? 'Or' : 'Failed',
        text: 'NEW ROOM',
        amount: '', showDollar: false,
        right: note === null ? 'Seats you first' : 'Try again',
        chip: null,
        tone: 'normal',
        // Creating seats you immediately — there is no room-setup screen
        // between, which is the Lobby Flow correction.
        action: { kind: 'createRoom' },
      },
    ]),
  };
}

/** One explanatory row and one way out. */
function terminal(sub: string, status: string, text: string, right: string): ScreenDef {
  return {
    title: 'Online',
    sub,
    back: 'home',
    cols: ['', 'State', 'What happened', '', 'Action'],
    rows: padRows([
      {
        label: '', status, text,
        amount: '', showDollar: false, right,
        chip: null, tone: 'dim', action: null,
      },
      {
        label: '', status: '', text: 'BACK TO DEPARTURES',
        amount: '', showDollar: false, right: '',
        chip: null, tone: 'normal',
        action: { kind: 'navigate', to: 'home' },
      },
    ]),
  };
}

/**
 * The room is not there. It may have finished, or the server may have been
 * replaced with an empty disk — the lobby splits this from a refused seat
 * precisely because the remedies differ.
 */
export const roomGone = (): ScreenDef =>
  terminal('ROOM GONE', 'Gone', 'THAT ROOM IS NO LONGER RUNNING', 'Start a new one');

/** This client and the server disagree about the protocol. Reloading is the fix. */
export const staleClient = (): ScreenDef => ({
  ...terminal('OUT OF DATE', 'Stale', 'THIS PAGE IS OLDER THAN THE SERVER', 'Reload to update'),
  rows: padRows([
    {
      label: '', status: 'Stale', text: 'THIS PAGE IS OLDER THAN THE SERVER',
      amount: '', showDollar: false, right: 'Reload to update',
      chip: null, tone: 'dim', action: null,
    },
    {
      label: '', status: '', text: 'RELOAD',
      amount: '', showDollar: false, right: '',
      chip: null, tone: 'normal',
      // Its own screen rather than a navigation: nothing in the app can fix a
      // stale bundle, only fetching a new one.
      action: { kind: 'navigate', to: 'home' },
    },
  ]),
});

/** The seat was refused — usually a stored identity that has gone stale. */
export const roomRefused = (message: string | null): ScreenDef =>
  terminal('SEAT REFUSED', 'Refused', (message ?? 'THAT SEAT IS NOT YOURS').toUpperCase(),
           'Join again');
