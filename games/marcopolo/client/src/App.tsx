import { useHashRoute } from './router';
import { HomeScreen } from './screens/HomeScreen';
import { JoinScreen } from './screens/JoinScreen';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const route = useHashRoute();
  if (route.screen === 'room') return <RoomScreen key={route.roomId} roomId={route.roomId} />;
  return route.screen === 'join' ? <JoinScreen /> : <HomeScreen />;
}
