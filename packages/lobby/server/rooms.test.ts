import { describe, expect, it } from 'vitest';
import { createLobbyRegistry, seatPlayer, type LobbyRoomLike, type SeatHolder } from './rooms.js';
import type { Lifecycle } from '../protocol/protocol.js';

interface StubRoom extends LobbyRoomLike { stage: Lifecycle }

const makeStub = (id: string, players: SeatHolder[]): StubRoom => ({
  id,
  players,
  stage: 'lobby',
  lifecycle() { return this.stage; },
});

const SPACE = { ids: ['p1', 'p2', 'p3'] };
const registry = () => createLobbyRegistry<StubRoom>(makeStub, SPACE);

describe('seating from a fixed id space', () => {
  it('gives the host the first id', () => {
    const { player } = registry().create('Ada');
    expect(player.id).toBe('p1');
    expect(player.isHost).toBe(true);
  });

  it('hands each new arrival the next free id', () => {
    const r = registry();
    const { room } = r.create('Ada');
    expect(r.join(room.id, 'Margo')?.player.id).toBe('p2');
    expect(r.join(room.id, 'Dev')?.player.id).toBe('p3');
  });

  it('reuses a vacated id instead of minting a duplicate', () => {
    // The bug this whole change exists for: ids used to come from
    // players.length, which shrinks when leaveSeat splices the array.
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');
    r.join(room.id, 'Dev');

    room.players.splice(1, 1);            // p2 leaves, exactly as leaveSeat does
    const rejoined = r.join(room.id, 'Kit');

    expect(rejoined?.player.id).toBe('p2');
    expect(room.players.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    expect(new Set(room.players.map((p) => p.id)).size).toBe(room.players.length);
  });

  it('does not make a second host when the first seat is retaken', () => {
    // leaveSeat promotes players[0] when the host goes; a newcomer taking the
    // freed p1 must not arrive believing it is host as well.
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');

    room.players.splice(0, 1);            // the host leaves
    room.players[0]!.isHost = true;       // ...and the handler promotes the next
    r.join(room.id, 'Dev');               // who then takes the freed p1

    expect(room.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(room.players.find((p) => p.isHost)?.name).toBe('Margo');
  });

  it('refuses a join once every seat is taken', () => {
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');
    r.join(room.id, 'Dev');
    expect(r.join(room.id, 'Kit')).toBeNull();
  });

  it('names an unnamed arrival after the seat they actually got', () => {
    const r = registry();
    const { room } = r.create('Ada');
    r.join(room.id, 'Margo');
    room.players.splice(1, 1);
    expect(r.join(room.id)?.player.name).toBe('Player 2');
  });

  it('lets a game supply its own ids and default names', () => {
    // Rail Baron's seats are colours, and the colour *is* the id — which is
    // why the lobby needs no badge field: the decoration is the identity.
    const space = { ids: ['red', 'green'], defaultName: (i: number) => `Baron ${i + 1}` };
    const r = createLobbyRegistry<StubRoom>(makeStub, space);
    const { room, player } = r.create();
    expect(player.id).toBe('red');
    expect(player.name).toBe('Baron 1');
    expect(r.join(room.id)?.player.id).toBe('green');
  });

  it('seats nobody into a space with no ids, rather than inventing one', () => {
    expect(seatPlayer({ ids: [] }, [], 'Ada')).toBeNull();
  });
});

describe('reserved (pending) seats', () => {
  it('reserves the first free id and keeps it from ordinary joiners', () => {
    const r = registry();
    const { room } = r.create('Ada');
    expect(r.reserve(room.id, 'hash-1', 'Sam')).toBe('p2');
    // The next joiner routes around the reservation.
    expect(r.join(room.id, 'Margo')?.player.id).toBe('p3');
    expect(room.pending).toEqual([
      { id: 'p2', tokenHash: 'hash-1', name: 'Sam', invitedAt: expect.any(Number) },
    ]);
  });

  it('counts reservations toward capacity', () => {
    const r = registry();
    const { room } = r.create('Ada');
    r.reserve(room.id, 'h1', 'Sam');
    r.reserve(room.id, 'h2', null);
    expect(r.reserve(room.id, 'h3', 'Kit')).toBeNull(); // full
    expect(r.join(room.id, 'Margo')).toBeNull(); // and so is joining
  });

  it('refuses to reserve outside the lobby', () => {
    const r = registry();
    const { room } = r.create('Ada');
    room.stage = 'playing';
    expect(r.reserve(room.id, 'h1', 'Sam')).toBeNull();
  });

  it('claims by hash exactly once, minting a token and no presence', () => {
    const r = registry();
    const { room } = r.create('Ada');
    const id = r.reserve(room.id, 'hash-1', 'Sam');
    const claimed = r.claimByHash(room.id, 'hash-1');
    expect(claimed?.player).toMatchObject({
      id, name: 'Sam', isHost: false, connected: false,
    });
    expect(claimed?.player.token).toBeTruthy();
    expect(room.pending).toEqual([]);
    // Spent: absent room, absent hash and already-claimed all read alike.
    expect(r.claimByHash(room.id, 'hash-1')).toBeNull();
    expect(r.claimByHash('ZZZZZZ', 'hash-1')).toBeNull();
  });

  it('claims an email reservation (no name) under the seat default', () => {
    const r = registry();
    const { room } = r.create('Ada');
    r.reserve(room.id, 'hash-1', null);
    expect(r.claimByHash(room.id, 'hash-1')?.player.name).toBe('Player 2');
  });

  it('a claimer into an emptied room is its first player, and its host', () => {
    const r = registry();
    const { room } = r.create('Ada');
    r.reserve(room.id, 'hash-1', 'Sam');
    room.players.splice(0, 1); // the host left; only the reservation remains
    expect(r.claimByHash(room.id, 'hash-1')?.player.isHost).toBe(true);
  });

  it('a joiner into an emptied-but-reserved room is host, not stranded', () => {
    // isHost is "players only": folding pending ids into `taken` would seat
    // this joiner as a non-host in a room where nobody could begin or revoke.
    const r = registry();
    const { room } = r.create('Ada');
    r.reserve(room.id, 'hash-1', 'Sam');
    room.players.splice(0, 1);
    expect(r.join(room.id, 'Margo')?.player.isHost).toBe(true);
  });

  it('revokes pending seats only, freeing the id', () => {
    const r = registry();
    const { room } = r.create('Ada');
    const id = r.reserve(room.id, 'hash-1', 'Sam')!;
    expect(r.revoke(room.id, 'p1')).toBe(false); // occupied, never
    expect(r.revoke(room.id, id)).toBe(true);
    expect(r.revoke(room.id, id)).toBe(false); // already gone
    expect(r.join(room.id, 'Margo')?.player.id).toBe(id);
  });
});
