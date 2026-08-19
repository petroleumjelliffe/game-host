# Multiplayer Architecture Plan

> **Superseded, 2026-08-05.** This describes an earlier design: `SocketContext.tsx`, `playerId.ts`
> and `Game.tsx` are deleted, and the XState layer this plan led to was removed in Phase 3a. For the
> current architecture, start at `CLAUDE.md` and
> `docs/superpowers/specs/2026-08-05-phase-3b-networked-client-design.md`. Kept for history, not
> current guidance.

## Overview
Transform the single-client game into a multiplayer experience with:
- Hidden hands (only current player sees their tiles)
- Server-authoritative game state
- Waiting room for player connections
- Public player summary panel

## Architecture Components

### 1. Technology Stack

**Server:**
- Node.js/Express backend
- Socket.io for real-time WebSocket communication
- File-based persistent storage (JSON files) for game state
- UUID generation for game instances and player IDs

**Client:**
- Existing React/TypeScript frontend
- Socket.io-client for server communication
- LocalStorage for persistent client ID
- Separate views for active player vs. spectators

### 1.5 Persistent State & Asynchronous Play

**Game Instance Management:**
- Each game gets a unique hash/ID (e.g., `game-a3f9c2d8`)
- Game state saved to disk after every action
- Games can be resumed at any time using the game ID
- State includes: board, players, turn index, stage, bag, etc.

**Player Identity:**
- Each client generates/retrieves a persistent UUID on first load
- Stored in localStorage: `playerId`
- Used to authenticate player actions
- Allows reconnection to in-progress games

**Asynchronous Play Support:**
- Game state tracks which player's turn it is
- Server validates that actions come from the correct player ID
- Other players shown "Waiting for [PlayerName]..." indicator
- Players can disconnect and reconnect without losing state
- Game persists indefinitely until completed
- No timeouts - players can take turns hours/days apart

**Connection State Tracking:**
- Each player has `isConnected` boolean in game state
- Online/offline indicators shown to all players
- Current player must be connected to take action
- Other players can view game state even if current player offline

### 2. Server Structure

```
server/
├── index.ts              # Express + Socket.io setup
├── gameManager.ts        # Manages multiple game rooms
├── gameState.ts          # Server-side game state logic (from gameLogic.ts)
├── roomManager.ts        # Waiting room & player connections
├── persistence.ts        # Save/load game state to/from disk
├── playerAuth.ts         # Validate player IDs and turn ownership
├── types.ts              # Shared types with client
└── games/                # Directory storing saved game states
    ├── game-a3f9c2d8.json
    ├── game-b7e4d1f2.json
    └── ...
```

### 3. Client Changes

**New Components:**
- `WaitingRoom.tsx` - Pre-game lobby for players to join
- `PlayerSummary.tsx` - Public info panel (cash, share counts, turn order, online/offline status)
- `ConnectionStatus.tsx` - Shows connection state
- `WaitingForPlayer.tsx` - Overlay shown when it's another player's turn
- `PlayerIdManager.tsx` - Generates/retrieves persistent player ID

**Modified Components:**
- `Game.tsx` - Add multiplayer context, socket listeners
- `Board.tsx` - Only show tile previews for current player
- `PlayerHand.tsx` - Only show hand for current player
- `BuyModal.tsx` - Only show to current player
- `MergerLiquidation.tsx` - Only show to relevant player

**New Hooks:**
- `useSocket.ts` - Socket.io connection management
- `useGameRoom.ts` - Room joining/leaving logic

### 4. Game Flow

#### Phase 1: Waiting Room
1. Players enter room code or create new room
2. Players see list of connected players
3. Host can start game when 2-6 players ready
4. Server generates initial game state

#### Phase 2: Game Play
1. Server broadcasts game state to all clients
2. Each client filters visibility based on player ID
3. Current player sees their hand + can interact
4. Other players see public info only
5. Player actions sent to server for validation
6. Server updates state, broadcasts to all

#### Phase 3: Game End
1. Server calculates final scores
2. Display results to all players
3. Option to start new game or return to lobby

### 5. Data Flow

**Client → Server Events:**
- `registerPlayer` - Send persistent player ID to server
- `joinRoom` - Join existing game room (includes playerId)
- `createRoom` - Create new game room (includes playerId, playerName)
- `rejoinGame` - Reconnect to existing game (includes gameId, playerId)
- `startGame` - Host starts the game
- `placeTile` - Player places a tile (includes playerId for validation)
- `foundStartup` - Player founds a startup (includes playerId)
- `buyShares` - Player purchases shares (includes playerId)
- `liquidateShares` - Player liquidates during merger (includes playerId)
- `disconnect` - Player disconnects

**Server → Client Events:**
- `playerRegistered` - Confirmation of player ID
- `roomJoined` - Confirmation of room join (includes gameId)
- `roomState` - Waiting room player list
- `gameStarted` - Game has begun (includes full game state)
- `gameState` - Full game state update
- `gameResumed` - Successfully reconnected to game
- `playerTurn` - Notifies whose turn it is (includes playerId, playerName, isConnected)
- `playerConnected` - Player came online
- `playerDisconnected` - Player went offline
- `invalidMove` - Action rejected by server (reason: wrong player, invalid action, etc.)
- `invalidPlayer` - Player ID not authorized for this action
- `gameEnded` - Game over with results
- `gameSaved` - State persisted successfully (debug event)

### 6. State Visibility Rules

**Public Information (visible to all):**
- Board state (placed tiles, startups)
- Player names, turn order
- Player cash totals
- Player share counts per startup
- Player online/offline status
- Game log
- Available shares per startup
- Current stage (play, buy, merger, etc.)
- Whose turn it is (name + online status)

**Private Information (current player only):**
- Player's hand (tile cards)
- Tile placement previews on board
- Buy/merger decision modals
- Action buttons (only enabled for current player)

**Server-Only Information:**
- Tile bag contents
- Future draw order
- Validation state
- Player ID → Player mapping for authentication

### 7. Security & Validation

**Action Authentication:**
- Every game action includes the player's persistent ID
- Server validates: `action.playerId === currentPlayerInTurn.id`
- Prevents wrong player from taking someone else's turn
- Rejects actions if player ID doesn't match

**State Integrity:**
- Server validates all moves before applying
- Clients cannot see other players' hands
- Game state stored server-side (clients can't cheat)
- Room codes prevent unauthorized access
- Rate limiting on actions

**Reconnection Handling:**
- Client stores last gameId in localStorage
- On reconnect, client sends: `rejoinGame(gameId, playerId)`
- Server validates player was in that game
- Server resends current game state to reconnecting client
- Other players notified of reconnection

**Persistence & Recovery:**
- Game state auto-saved after every action
- Server can restart without losing games
- Games loaded from disk on server startup
- Corrupted save files logged and skipped

### 8. Implementation Phases

**Phase A: Server Setup**
1. Install dependencies (socket.io, express, uuid)
2. Create basic Express server
3. Set up Socket.io
4. Implement persistence layer (save/load JSON)
5. Implement player authentication
6. Implement room manager
7. Port game logic to server with validation

**Phase B: Client Infrastructure**
1. Install socket.io-client
2. Implement persistent player ID (localStorage)
3. Create socket hooks
4. Create waiting room UI
5. Add player summary panel with online/offline indicators
6. Add "Waiting for Player" overlay
7. Update App.tsx for room flow

**Phase C: Game State Sync**
1. Refactor game state to client/server model
2. Add socket event listeners in Game.tsx
3. Filter visible state by player ID
4. Replace local state updates with server calls
5. Implement turn validation (only current player can act)
6. Handle optimistic updates + server validation
7. Add reconnection logic

**Phase D: Testing & Polish**
1. Test 2-6 player scenarios
2. Test asynchronous play (players leaving/rejoining)
3. Test reconnection after disconnect
4. Test wrong player attempting actions
5. Test server restart with saved games
6. Polish UI/UX
7. Add game replay/history

### 9. Environment Configuration

**Development:**
- Client: `http://localhost:5173` (Vite dev server)
- Server: `http://localhost:3001` (Express server)
- Socket.io: Same port as Express

**Production:**
- Deploy server to service (Render, Railway, Fly.io)
- Update client socket connection URL
- Deploy client to GitHub Pages (existing setup)

### 10. File Changes Summary

**New Files:**
- `server/` directory (entire backend)
  - `server/index.ts`
  - `server/gameManager.ts`
  - `server/gameState.ts`
  - `server/roomManager.ts`
  - `server/persistence.ts`
  - `server/playerAuth.ts`
  - `server/types.ts`
  - `server/games/` (directory for saved states)
- `src/hooks/useSocket.ts`
- `src/hooks/useGameRoom.ts`
- `src/hooks/usePlayerId.ts` - Manages persistent player ID
- `src/components/WaitingRoom.tsx`
- `src/components/PlayerSummary.tsx`
- `src/components/ConnectionStatus.tsx`
- `src/components/WaitingForPlayer.tsx` - Overlay for other player's turn
- `src/context/SocketContext.tsx`
- `src/utils/playerId.ts` - localStorage player ID utilities

**Modified Files:**
- `package.json` - Add server dependencies, server scripts
- `src/App.tsx` - Add room flow, reconnection logic
- `src/Game.tsx` - Socket integration, player validation
- `src/components/Board.tsx` - Conditional preview visibility
- `src/components/PlayerHand.tsx` - Conditional visibility
- `src/components/BuyModal.tsx` - Conditional visibility, player validation
- `src/components/MergerLiquidation.tsx` - Conditional visibility, player validation
- `src/state/gameTypes.ts` - Add multiplayer types (playerId, isConnected, gameId)
- `vite.config.ts` - Proxy config for dev

## Next Steps

1. Review and approve architecture
2. Install server dependencies
3. Create basic server structure
4. Implement waiting room
5. Add player summary panel
6. Refactor state management
7. Implement visibility logic
8. Test multiplayer scenarios
