// session/view.ts
// The redaction. This is the game's whole privacy boundary, so the rule is
// structural: `viewFor` is the only function that turns a GameState into
// anything a client sees, and the GameView type it returns has no field
// that could hold another player's rack, the bag's contents, or the seed.
//
// `viewerId: null` is the spectator view — no rack at all.

import { getCurrentActor } from '../engine/actor.js';
import type { GameState } from '../engine/gameTypes.js';
import type { GameView, PlayerView } from './protocol.js';

export function viewFor(state: GameState, viewerId: string | null): GameView {
  const players: PlayerView[] = state.players.map((player) => ({
    id: player.id,
    name: player.name,
    score: player.score,
    rackCount: player.rack.length,
    rack: player.id === viewerId ? [...player.rack] : null,
  }));
  const view: GameView = {
    stage: state.stage,
    players,
    turnIndex: state.turnIndex,
    currentPlayerId: getCurrentActor(state),
    board: state.board.map((square) => (square === null ? null : { ...square })),
    bagCount: state.bag.length,
    scorelessTurns: state.scorelessTurns,
    moveCount: state.moveCount,
    log: state.log.map((entry) => ({ ...entry })),
  };
  if (state.final) {
    view.final = {
      adjustments: state.final.adjustments.map((a) => ({ ...a })),
      winnerIds: [...state.final.winnerIds],
    };
  }
  return view;
}
