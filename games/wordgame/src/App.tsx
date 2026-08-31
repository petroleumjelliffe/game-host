import { Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { OnlineLobbyPage } from './pages/OnlineLobbyPage';
import { JoinRoomPage } from './pages/JoinRoomPage';
import { RoomPage } from './pages/RoomPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/online" element={<OnlineLobbyPage />} />
      <Route path="/online/join" element={<JoinRoomPage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      {/* No URL renders a white screen — unknown paths go home instead
          (the installed-app start_url lesson from Acquire). */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
