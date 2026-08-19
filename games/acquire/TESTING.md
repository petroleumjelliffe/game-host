# Testing the Multiplayer Server

## Quick Start

### 1. Start the Server
The server should already be running. If not, run:
```bash
npm run dev:server
```

You should see:
```
🚀 Server running on port 3001
   Health check: http://localhost:3001/health
```

### 2. Open the Test Page

Simply open this file in your browser:
```
server/test.html
```

Or use:
```bash
open server/test.html
```

### 3. Test Scenarios

#### **Solo Testing (1 Browser)**
1. Enter your name (e.g., "Alice")
2. Click **Connect**
3. Click **Create New Room**
4. You'll see a Room ID (e.g., `game-abc123`)
5. Note: You can't start a game alone (need 2-6 players)

#### **Multiplayer Testing (2+ Browser Windows)**
1. **Window 1:**
   - Name: "Alice"
   - Click **Connect**
   - Click **Create New Room**
   - Copy the Room ID shown (e.g., `game-abc123`)

2. **Window 2:**
   - Name: "Bob"
   - Click **Connect**
   - Paste the Room ID in the input field
   - Click **Join Room**
   - Both players should appear in the player list

3. **Start Game (Window 1 - Host):**
   - Click **Start Game** (only visible to host)
   - Both windows should show "Game started!" message

#### **Test Reconnection:**
1. Create a room and note the Room ID
2. Close the browser window
3. Open `test.html` again
4. Click **Connect**
5. Enter the same Room ID and click **Join Room**
6. You should rejoin the room

## What to Look For

### ✅ Connection Status
- Green dot (🟢) when connected
- Red dot (⚫) when disconnected

### ✅ Room Features
- Room ID generation
- Player list with host indicator
- Online/offline status per player
- "Start Game" button (only for host, only with 2+ players)

### ✅ Event Log
All events appear in the log at the bottom:
- Connection events
- Room creation/joining
- Player joins/leaves
- Game start

### ✅ Server Console
Watch the terminal where `npm run dev:server` is running to see:
- Client connections
- Room creation
- Player registration
- Game starts

## Server Endpoints

### Health Check
```bash
curl http://localhost:3001/health
```

Returns:
```json
{
  "status": "ok",
  "games": 0,
  "rooms": 1
}
```

## Troubleshooting

### Server not responding?
```bash
# Check if server is running
curl http://localhost:3001/health

# Restart server
# Press Ctrl+C in the server terminal, then:
npm run dev:server
```

### Can't connect from browser?
- Make sure you're using `http://localhost:3001` (not https)
- Check browser console (F12) for errors
- Verify server is running on port 3001

### Room not found?
- Room IDs are case-sensitive
- Rooms are deleted when all players leave
- Copy the exact Room ID from the host's screen

## Advanced Testing

### Test Persistent Player ID
1. Connect and create a room
2. Open browser DevTools (F12) → Console
3. Run: `localStorage.getItem('playerId')`
4. You should see your persistent player ID
5. Close and reopen the browser - same ID should persist

### Test Multiple Games
1. Create Room 1 in Window 1
2. Create Room 2 in Window 2
3. Both rooms should work independently
4. Check health endpoint - should show 2 rooms

### Test Auto-Cleanup
1. Create a room
2. Close all browser windows connected to it
3. Check health endpoint - room should be deleted
4. Check server console - should show "Deleted empty room"
