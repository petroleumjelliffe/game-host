import type { GameState } from './gameTypes';
import type { Intent } from './intents';
import { applyIntent } from './intents';

/**
 * stepId → the state as it was BEFORE that step ran.
 *
 * Deliberately not a field on `GameState`. `applyIntent` deep-clones the whole
 * state on every call, and every state carries its log; a snapshot stored inside
 * a log entry would therefore be re-cloned on every subsequent intent, along with
 * every snapshot nested inside it. The cost is exponential in step count and
 * invisible in any short test. Keeping the store outside also keeps snapshots —
 * which contain the bag and every hand — out of anything a server broadcasts.
 */
export type SnapshotStore = Map<number, GameState>;

export function createSnapshotStore(): SnapshotStore {
  return new Map();
}

/**
 * Snapshots `state` under the stepId the next log entry will carry, then applies
 * the intent. A rejected intent throws out of `applyIntent` before the snapshot
 * can mislead anyone: on the way out, the entry is restored to whatever it held
 * before this call — deleted if this call is what created it, or put back if a
 * prior `rewindTo` had already filed a legitimate snapshot there. `rewindTo`
 * deliberately keeps the entry AT the step it rewinds to (that's what makes a
 * repeated rewind idempotent), so retrying with an illegal intent right after a
 * rewind lands on a stepId that is already occupied. Unconditionally deleting
 * would destroy that still-valid snapshot and break a later rewind to the same
 * step — exactly the undo-then-retry sequence the undo UI exists for.
 */
export function applyIntentWithHistory(
  store: SnapshotStore,
  state: GameState,
  intent: Intent,
): GameState {
  const stepId = state.nextStepId;
  const hadEntry = store.has(stepId);
  const previous = store.get(stepId);
  store.set(stepId, structuredClone(state));
  try {
    return applyIntent(state, intent);
  } catch (e) {
    if (hadEntry) {
      store.set(stepId, previous!);
    } else {
      store.delete(stepId);
    }
    throw e;
  }
}

/**
 * The state before `stepId` ran. Every entry AFTER `stepId` is dropped; the
 * entry at `stepId` is kept, which is what makes a repeated rewind to the same
 * step return the same state instead of throwing. Rewinding leaves the game
 * about to run `stepId` again, and the next `applyIntentWithHistory` overwrites
 * that entry with an identical snapshot.
 */
export function rewindTo(store: SnapshotStore, stepId: number): GameState {
  const snapshot = store.get(stepId);
  if (!snapshot) throw new Error(`no snapshot for step ${stepId}`);
  for (const key of [...store.keys()]) {
    if (key > stepId) store.delete(key);
  }
  return structuredClone(snapshot);
}
