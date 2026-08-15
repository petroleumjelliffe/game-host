import { useHashRoute } from './router';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const route = useHashRoute();
  return route.screen === 'home' ? <HomeScreen /> : <RoomScreen key={route.roomId} roomId={route.roomId} />;
}
