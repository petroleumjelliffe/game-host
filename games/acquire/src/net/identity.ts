import { createIdentityStore } from '../../vendor/lobby/client/identity';
export type { RoomIdentity } from '../../vendor/lobby/client/identity';

/** This game's identity store. The appId is the localStorage namespace —
 * changing it logs every player out of every room. */
const store = createIdentityStore('acquire');
export const { loadIdentity, saveIdentity, clearIdentity, rememberedName, rememberName } = store;
export const acquireIdentity = store;
