import { useCallback, useEffect, useState } from 'react';
import {
  d6, destinationInRegion, nodeForCity, rollDestination, rollTurn,
  type NodeId, type RegionId, type Rng, type RollOutcome, type TrainType, type TurnRoll
} from '../../engine';
import { SEATS, type GameEvent, type SeatId } from './events';
import { currentCity, replay, undo } from './game';
import { homesTaken, needsDestination, nextHomeSeat } from './turns';
import { STORAGE_KEY, clearLog, loadLog, saveLog } from './storage';

export function useGame(rng: Rng = Math.random) {
  const [events, setEvents] = useState<GameEvent[]>(() => loadLog().events);
  // Read once, at mount: this is the age of the record we resumed from, not
  // of the save this session goes on to write.
  const [savedAt] = useState<number | null>(() => loadLog().savedAt);

  // loadLog() already defaults to [] when nothing is stored, so an empty log
  // needs no entry of its own — persisting `{version,events:[]}` here would
  // just resurrect the key on the very next render after reset()'s
  // clearLog() call removed it, making that call a no-op in practice.
  useEffect(() => {
    if (events.length === 0) return;
    saveLog(events);
  }, [events]);

  /**
   * Follow the log when another tab writes it.
   *
   * Each tab used to read the store once, at mount, and never look again — so
   * a board on the tablet and a map on a second screen drifted apart the
   * moment either acted, and the stale one overwrote the other's work when it
   * next wrote. With committed moves and strict turn order that is a way to
   * lose a game rather than an inconvenience.
   *
   * `storage` fires in *other* tabs, never the one that wrote, so this cannot
   * hear its own save. Returning the current array unchanged when the logs
   * match keeps its identity, which keeps the save effect above from writing
   * it straight back and starting a volley.
   */
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      // A null key means the whole store was cleared, which concerns us too.
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      const loaded = loadLog().events;
      setEvents(current =>
        JSON.stringify(current) === JSON.stringify(loaded) ? current : loaded);
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, []);

  const state = replay(events);

  // The dice roll happens here, in the event handler body, reading `state`
  // from this render's closure. It must not live inside the setEvents
  // updater below: React 19's StrictMode deliberately invokes updaters
  // twice to catch ones that aren't pure, and an rng() call inside one
  // consumes two rolls for a single tap. The updater itself does nothing
  // but append the one event it was handed, so calling it twice is
  // harmless — both invocations compute the same result from the same
  // input and React keeps only the last.
  //
  // Naming used to be the other half of this hazard, via window.prompt.
  // The board's inline input replaced it, so only the roll remains — but
  // the roll is enough to keep the rule.
  //
  // Reading `state` from the render closure (rather than re-deriving it from
  // the updater's own `log` argument) means two taps landing in the same
  // tick could both read the same pre-tap state. For a single-user tablet
  // app where taps are sequential and each one waits for its own render,
  // that's not a real risk in practice — but it is a real trade-off, not an
  // oversight.
  /**
   * Rolls, and returns what was rolled. Deliberately appends nothing.
   *
   * THE GATE. A roll's consequence — the destination, the payout, or the
   * ballot that a baron's own region hands back to them — is visible the
   * moment the event describing it exists, because every screen on this board
   * is a pure function of the log. So the roll does not enter the log until
   * the board has finished announcing the region it produced.
   *
   * Splitting the two is what makes that structural rather than a convention
   * somebody has to remember. There is no way to append a roll except through
   * `commitRoll`, and its only caller is the handler that fires when the
   * region panel lands. A future screen cannot leak the outcome early by
   * reading the wrong thing, because until that moment there is nothing to
   * read.
   */
  const roll = useCallback((seat: SeatId): RollOutcome | null => {
    const current = state.seats[seat];
    if (current.awaiting !== null || current.name === null) return null;
    // A homeward baron rolls no destinations — home is the destination.
    if (current.homeward) return null;
    // A destination is rolled once per trip, at its start. The guard is here
    // rather than on the screen so that no future screen can route round it.
    if (!needsDestination(current, nodeForCity)) return null;
    if (state.phase === 'homes' && nextHomeSeat(state) !== seat) return null;
    if (state.phase === 'playing' && state.turn !== seat) return null;
    return rollDestination(currentCity(current), rng, homesTaken(state));
  }, [state, rng]);

  /** The only way a roll reaches the log. See `roll`. */
  const commitRoll = useCallback((seat: SeatId, outcome: RollOutcome) => {
    setEvents(log => {
      switch (outcome.kind) {
        case 'home':
          return [...log,
            { type: 'arrived', seat, city: outcome.city, region: outcome.region, payout: null }];
        case 'arrived':
          return [...log,
            { type: 'arrived', seat, city: outcome.city, region: outcome.region, payout: outcome.payout }];
        case 'chooseRegion':
          return [...log, { type: 'regionRequested', seat, rolled: outcome.rolled }];
      }
    });
  }, []);

  const chooseRegion = useCallback((seat: SeatId, region: RegionId) => {
    const current = state.seats[seat];
    const from = currentCity(current);
    if (from === null || current.awaiting === null) return;
    const arrival = destinationInRegion(from, region, rng);
    setEvents(log => [...log,
      { type: 'arrived', seat, city: arrival.city, region: arrival.region, payout: arrival.payout }]);
  }, [state, rng]);

  /**
   * The white movement dice — and only those. Deliberately appends nothing,
   * for the same reason `roll` does not: the board announces the faces before
   * the log carries them, and `commitDice` is the only way in.
   *
   * The bonus die is not thrown here. It is a roll of its own, taken once the
   * white movement has been walked — see `rollBonus`.
   */
  const rollDice = useCallback((seat: SeatId): TurnRoll | null => {
    if (state.phase !== 'playing' || state.turn !== seat) return null;
    if (state.rolled !== null) return null;             // one roll per turn
    const rollingSeat = state.seats[seat];
    if (!rollingSeat.homeward && needsDestination(rollingSeat, nodeForCity)) return null;
    // The money spec kept its promise: the train is the rules' to name.
    const train: TrainType = state.rules.startingTrain;
    return rollTurn(train, rng);
  }, [state, rng]);

  const commitDice = useCallback((seat: SeatId, roll: TurnRoll) => {
    setEvents(log => [...log, {
      type: 'turnRolled', seat,
      white: [roll.white[0], roll.white[1]], bonus: roll.bonus
    }]);
  }, []);

  /**
   * The Bonus Roll, thrown after the white movement has been walked. The third
   * gate, and the same split as the other two: this hands back a face and
   * appends nothing, `commitBonus` is the only way one reaches the log, and
   * its only caller is the handler that fires when the red drum lands.
   *
   * `state.bonusOwed` carries the whole entitlement rule, so there is nothing
   * to decide here beyond whose turn it is. The extra guard is the book's
   * order after an arrival: the new destination is rolled first, and
   * `needsDestination` is exactly "the pawn is standing on the place it was
   * heading for". A leg that did not arrive fails it and rolls straight on.
   */
  const rollBonus = useCallback((seat: SeatId): number | null => {
    if (state.phase !== 'playing' || state.turn !== seat) return null;
    if (!state.bonusOwed) return null;
    const bonusSeat = state.seats[seat];
    if (!bonusSeat.homeward && needsDestination(bonusSeat, nodeForCity)) return null;
    return d6(rng);
  }, [state, rng]);

  /** The only way a Bonus Roll reaches the log. See `rollBonus`. */
  const commitBonus = useCallback((seat: SeatId, face: number) => {
    setEvents(log => [...log, { type: 'bonusRolled', seat, face }]);
  }, []);

  const commitMove = useCallback((seat: SeatId, path: readonly NodeId[], arrived: boolean) => {
    setEvents(log => [...log, { type: 'moved', seat, path: [...path], arrived }]);
  }, []);

  /**
   * "The players roll to see who goes first, the high roll." Rolled once and
   * recorded, so a replayed game deals the same turns; ties are settled by
   * rolling again rather than by seat order, which would quietly favour red.
   * A tie surviving 100 rerolls is astronomically unlikely — throwing rather
   * than falling back to `best[0]` matches `rollDestination`'s precedent for
   * an exhausted guard: a loud failure beats a silent, seat-order first
   * player that contradicts this very comment.
   */
  const rollOrder = useCallback(() => {
    const seated = SEATS.filter(id => state.seats[id].name !== null);
    if (seated.length === 0) return;
    let best: SeatId[] = [];
    for (let attempt = 0; attempt < 100 && best.length !== 1; attempt++) {
      best = [];
      let high = 0;
      for (const id of seated) {
        const score = Math.floor(rng() * 6) + Math.floor(rng() * 6) + 2;
        if (score > high) { high = score; best = [id]; }
        else if (score === high) best.push(id);
      }
    }
    if (best.length > 1) throw new Error('turn order stayed tied after 100 rerolls');
    const first = best[0]!;
    setEvents(log => (log.some(e => e.type === 'orderRolled')
      ? log
      : [...log, { type: 'orderRolled', seat: first, first }]));
  }, [state, rng]);

  /**
   * An empty name vacates the seat. Whether that is a `joined` or a
   * `renamed` event is decided from the log itself rather than from this
   * render's `state`, so two commits in one tick cannot both read a seat
   * as empty and append two `joined` events for it.
   */
  const rename = useCallback((seat: SeatId, name: string | null) => {
    setEvents(log => {
      const seated = replay(log).seats[seat].name !== null;
      if (!seated && name) return [...log, { type: 'joined', seat, name }];
      return [...log, { type: 'renamed', seat, name: name || null }];
    });
  }, []);

  const start = useCallback(() => {
    setEvents(log => (log.some(e => e.type === 'started') ? log : [...log, { type: 'started' }]));
  }, []);

  const undoLast = useCallback(() => setEvents(log => undo(log)), []);
  const reset = useCallback(() => { clearLog(); setEvents([]); }, []);

  return {
    state, savedAt, roll, commitRoll, chooseRegion,
    rollDice, commitDice, rollBonus, commitBonus, commitMove, rollOrder,
    rename, start, undoLast, reset
  };
}
