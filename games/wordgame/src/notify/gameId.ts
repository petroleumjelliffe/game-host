/**
 * The game's notify id, in one place. It names this game to the shared
 * notification service — the bind key, and the scope tag on every push
 * subscription this client mints. A typo'd tag is worse than no tag: the
 * server stores any string, and a subscription tagged with a name no game
 * sends under would receive nothing while the UI reports push enabled
 * (the service strips tags naming no registered game to guard the
 * composed deployment, but the standalone dev server can only check
 * against itself).
 */
export const GAME_ID = 'wordgame';
