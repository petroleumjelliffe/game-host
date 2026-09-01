import { Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { JoinRoomPage } from './pages/JoinRoomPage';
import { RoomPage } from './pages/RoomPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* The old two-door lobby page is gone — HomePage is the entry
          screen now, doors and all — but a bookmarked or shared /online
          link should still land somewhere real. */}
      <Route path="/online" element={<Navigate to="/" replace />} />
      <Route path="/online/join" element={<JoinRoomPage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      {/* No URL renders a white screen — unknown paths go home instead
          (the installed-app start_url lesson from Acquire). */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
