import { createIdentityStore } from '@game-host/lobby/client/identity';
export type { RoomIdentity } from '@game-host/lobby/client/identity';

/** This game's identity store. The appId is the localStorage namespace —
 * changing it logs every player out of every room. */
const store = createIdentityStore('wordgame');
export const { loadIdentity, saveIdentity, clearIdentity, rememberedName, rememberName, listRooms } = store;
export const wordgameIdentity = store;
