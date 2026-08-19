import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { OnlineLobbyPage } from "./pages/OnlineLobbyPage";
import { JoinRoomPage } from "./pages/JoinRoomPage";
import { PassAndPlayPage } from "./pages/PassAndPlayPage";
import { PassAndPlayGamePage } from "./pages/PassAndPlayGamePage";
import { RoomPage } from "./pages/RoomPage";

// Dev surfaces only — not shipped (owner, 2026-08-08: "for testing only,
// shouldn't be available in the deployed clients"). The client-side twin of
// the server's /dev/rooms, which registers only under `npm run dev:server`
// (NODE_ENV === 'development', checked in server/index.ts) — not merely
// "outside production": `npm run serve` / `start:server` set no NODE_ENV
// and don't get the route either.
//
// `import.meta.env.DEV` is replaced with a literal at build time, so in a
// production build the branch below is dead code: the routes vanish AND the
// dynamic imports are never emitted as chunks — golden-game data included.
// That upgrades `npm run check:bundle`'s guarantee from "the golden data is
// not in the main chunk" to "it is not in the build at all", and the guard
// greps the whole of dist/assets to hold it there.
//
// Still lazy in dev, for the original reason: neither belongs in the chunk
// the dev server serves first.
const CatalogPage = import.meta.env.DEV
  ? React.lazy(() => import("./game/catalog/CatalogPage"))
  : null;
const ScenarioPage = import.meta.env.DEV
  ? React.lazy(() => import("./game/catalog/ScenarioPage"))
  : null;

export default function App() {
  return (
    <Routes>
      {/* Home - mode selection */}
      <Route path="/" element={<HomePage />} />

      {/* Online multiplayer flow */}
      <Route path="/online" element={<OnlineLobbyPage />} />
      <Route path="/online/join" element={<JoinRoomPage />} />

      {/* Pass and play: the lobby, then the board. Split so the back button
          leaves the game rather than destroying it — the game route mounts
          from the save, and this route is where it is continued or replaced. */}
      <Route path="/pass-and-play" element={<PassAndPlayPage />} />
      <Route path="/pass-and-play/game" element={<PassAndPlayGamePage />} />

      {/* Room page - for both host and joining players */}
      <Route path="/room/:roomId" element={<RoomPage />} />

      {/* Component catalog (the Phase 1 acceptance surface) and /scenarios
          (any golden-game state, playable from that point — a merger is two
          clicks away instead of several minutes of play). Dev builds only;
          see the note on the imports above. In a production build these
          paths fall through to nothing, exactly like any other unknown URL. */}
      {CatalogPage && (
        <Route
          path="/catalog"
          element={
            <React.Suspense fallback={null}>
              <CatalogPage />
            </React.Suspense>
          }
        />
      )}
      {ScenarioPage && (
        <Route
          path="/scenarios"
          element={
            <React.Suspense fallback={null}>
              <ScenarioPage />
            </React.Suspense>
          }
        />
      )}

      {/* No URL renders a white screen. Found by installing on a phone from
          the dev server: the manifest's start_url is the prod base path, the
          dev router had no route there, and React rendered nothing at all —
          an installed app whose first impression was a blank page. Unknown
          paths go home instead. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
