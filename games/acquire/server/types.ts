// server/types.ts
// Types shared across the server's modules. The wire's types live in
// `session/protocol.ts`, because 3b's client speaks the other half of them.

export type { RoomPlayer, Lifecycle, Delivery, GameRoom } from './room.js';
export type { Seat, RoomRegistry } from './rooms.js';
