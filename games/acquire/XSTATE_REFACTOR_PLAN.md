# XState Refactor Plan for Acquire Game

> **Superseded, 2026-08-05.** The XState layer this plan describes (`gameRoomMachine`,
> `playerMachine`) was removed in Phase 3a in favour of a plain authoritative server; the client it
> assumes (`Game.tsx`, `SocketContext.tsx`) is deleted as of Phase 3b. For the current architecture,
> start at `CLAUDE.md` and `docs/superpowers/specs/2026-08-05-phase-3a-server-authority-design.md`.
> Kept for history, not current guidance.

## Context

**Current Issues:**
- Multiplayer board game on Render with WebSockets
- Intermittent disconnections/reconnections not handled well
- String-based state machine (switch on `stage: Stage`) lacks explicit transitions
- Merger phase complexity: needs to cycle through players during one player's turn
- Modals must appear sequentially on each player's device
- Render free tier spins down after 15min inactivity

**Goal:** Replace string-based state management with XState actor model for robust multiplayer state management and reconnection handling.

---

## Architecture Overview

### Parent-Child Actor Model

```
GameRoomActor (server)
├── PlayerActor (player 1)
├── PlayerActor (player 2)
├── PlayerActor (player 3)
└── ...
```

**Key Principle:** Only the parent (GameRoomActor) sends events to children (PlayerActors). Players communicate back using `sendParent()`. This prevents race conditions.

---

## Game Room Actor (Server-Side)

### Context
```typescript
interface GameRoomContext {
  // Current game state (board, startups, etc)
  gameState: GameState;

  // Turn management
  currentPlayerIndex: number;        // whose normal turn it is
  currentMergerPlayerIndex: number | null; // who's resolving merger decisions

  // Merger flow tracking
  playersWithDefunctShares: string[]; // queue for liquidation
  mergerResolution: {
    survivorId: string;
    absorbedIds: string[];
    currentPlayerIndex: number;
  } | null;

  // Player actor management
  playerActors: Map<string, ActorRef>; // playerId -> actor reference
  socketMap: Map<string, string>;      // socketId -> playerId

  // Disconnection tracking
  disconnectTimers: Map<string, NodeJS.Timeout>; // playerId -> timeout
}
```

### States

```
GameRoomMachine
├── lobby
│   ├── waiting
│   └── ready
├── gameInProgress
│   ├── drawPhase (initial tile draw for turn order)
│   ├── playerTurn
│   │   ├── placeTile
│   │   ├── foundStartup
│   │   ├── mergerTriggered
│   │   │   ├── selectSurvivor
│   │   │   ├── payoutBonuses
│   │   │   └── liquidateShares (cycles through players)
│   │   └── buyStock
│   └── advanceTurn
└── gameOver
    ├── calculating
    └── complete
```

### Key Events

**From Client:**
- `PLAYER_JOINED` - new player connected
- `PLAYER_READY` - ready to start
- `START_GAME` - host starts game
- `TILE_PLACED` - tile placement submitted
- `STARTUP_FOUNDED` - startup selection made
- `MERGER_SURVIVOR_SELECTED` - survivor chosen
- `SHARES_LIQUIDATED` - liquidation choice made
- `SHARES_PURCHASED` - buy phase complete
- `TURN_COMPLETE` - player finished their actions
- `PLAYER_DISCONNECTED` - socket closed
- `PLAYER_RECONNECTED` - socket reopened

**To Client (via player actors):**
- `YOUR_TURN` - it's your turn to act
- `WAIT_FOR_PLAYER` - another player is acting
- `MERGER_DECISION_NEEDED` - you need to liquidate shares
- `GAME_STATE_SYNC` - full state snapshot on reconnect
- `PLAYER_JOINED_GAME` - notification
- `PLAYER_LEFT_GAME` - notification

### Transition Logic

**Normal Turn Flow:**
```
placeTile → (if isolated) → buyStock → advanceTurn
placeTile → (if founding) → foundStartup → buyStock → advanceTurn
placeTile → (if expansion) → buyStock → advanceTurn
placeTile → (if merger) → selectSurvivor → payoutBonuses → liquidateShares → buyStock → advanceTurn
```

**Merger Liquidation Flow:**
- `currentPlayerIndex` stays the same (still their turn)
- `currentMergerPlayerIndex` cycles through `playersWithDefunctShares`
- Each player receives `MERGER_DECISION_NEEDED` event in sequence
- After all liquidations: return to normal turn flow → buyStock

---

## Player Actor (Server-Side)

### Context
```typescript
interface PlayerContext {
  playerId: string;
  playerName: string;
  socketId: string | null;
  lastSeen: number; // timestamp
  gameRoomRef: ActorRef; // reference to parent
}
```

### States

```
PlayerMachine
├── connected
│   ├── waiting (default - not your turn)
│   ├── placingTile (your turn, play phase)
│   ├── foundingStartup (your turn, choosing startup)
│   ├── mergerDecision (your turn to liquidate, may not be your play turn)
│   └── buyingStock (your turn, buy phase)
├── disconnected (socket closed, 5min timeout)
└── abandoned (timeout expired)
```

### Events

**From Parent:**
- `YOUR_TURN` - transition to appropriate action state
- `WAIT` - return to waiting
- `MERGER_DECISION_NEEDED` - transition to mergerDecision
- `SOCKET_CONNECTED` - socket ID updated
- `SOCKET_DISCONNECTED` - transition to disconnected

**To Parent (via sendParent):**
- `TILE_PLACED`
- `STARTUP_FOUNDED`
- `SHARES_LIQUIDATED`
- `SHARES_PURCHASED`
- `TURN_COMPLETE`

---

## Server Implementation

### File Structure

```
server/
├── machines/
│   ├── gameRoomMachine.ts      # Main game state machine
│   ├── playerMachine.ts        # Individual player state machine
│   └── types.ts                # Shared XState types
├── actors/
│   ├── GameRoomActor.ts        # Game room actor logic
│   └── PlayerActor.ts          # Player actor logic
├── gameManager.ts              # Manages multiple game room actors
├── index.ts                    # Socket.IO integration
└── ...existing files...
```

### GameManager Refactor

**Current:** Stores `GameState` objects in memory/persistence
**New:** Stores XState actor references, persists snapshots

```typescript
class GameManager {
  private gameActors: Map<string, ActorRef<GameRoomMachine>>;

  createGame(gameId: string, players: Player[]) {
    const actor = createActor(gameRoomMachine, {
      input: { gameId, players }
    });
    actor.start();
    this.gameActors.set(gameId, actor);
    return actor;
  }

  getGameSnapshot(gameId: string) {
    const actor = this.gameActors.get(gameId);
    return actor?.getSnapshot();
  }

  playerConnected(gameId: string, playerId: string, socketId: string) {
    const actor = this.gameActors.get(gameId);
    actor?.send({
      type: 'PLAYER_CONNECTED',
      playerId,
      socketId
    });
  }
}
```

### Socket.IO Integration

**Key Changes:**
1. Replace direct state manipulation with actor events
2. Map socket events to XState events
3. Subscribe to actor state changes for broadcasts

```typescript
// server/index.ts

io.on("connection", (socket) => {

  socket.on("stateUpdate", (data) => {
    const actor = gameManager.getGameActor(data.gameId);

    // Map to appropriate XState event based on stage/action
    if (data.newState.stage === "buy") {
      actor?.send({
        type: "SHARES_PURCHASED",
        playerId: data.playerId,
        purchases: data.newState./* extract purchase info */
      });
    }
    // ... other mappings
  });

  socket.on("disconnect", () => {
    const actor = gameManager.getGameActor(socket.data.gameId);
    actor?.send({
      type: "PLAYER_DISCONNECTED",
      socketId: socket.id
    });
  });
});

// Subscribe to actor changes for broadcasting
function subscribeToGameActor(actor: ActorRef, gameId: string) {
  actor.subscribe((snapshot) => {
    // Broadcast state to all connected players
    io.to(gameId).emit("gameState", snapshot.context.gameState);

    // Send individual player notifications
    snapshot.context.playerActors.forEach((playerActor, playerId) => {
      const playerSnapshot = playerActor.getSnapshot();
      const socketId = snapshot.context.socketMap.get(playerId);

      if (socketId) {
        io.to(socketId).emit("playerState", playerSnapshot.value);
      }
    });
  });
}
```

---

## Client Implementation

### File Structure

```
src/
├── machines/
│   └── clientPlayerMachine.ts  # Client-side player state
├── hooks/
│   └── useGameConnection.ts    # WebSocket + XState integration
└── Game.tsx                     # UI subscribes to machine
```

### Client Machine (Optional)

The client can optionally use XState to mirror server state:

```typescript
// src/machines/clientPlayerMachine.ts
const clientPlayerMachine = setup({
  types: {} as {
    context: {
      gameState: GameState | null;
      myPlayerId: string;
      myState: "waiting" | "myTurn" | "mergerDecision";
    };
    events: {} as
      | { type: "GAME_STATE_SYNC"; state: GameState }
      | { type: "YOUR_TURN" }
      | { type: "WAIT_FOR_PLAYER" };
  }
}).createMachine({
  initial: "disconnected",
  states: {
    disconnected: {
      on: { CONNECTED: "connected" }
    },
    connected: {
      on: {
        GAME_STATE_SYNC: {
          actions: assign({ gameState: ({ event }) => event.state })
        }
      }
    }
  }
});
```

**OR** keep React `useState` for client and only use XState server-side.

---

## Migration Strategy

### Phase 1: Server-Side Actor Setup (No Breaking Changes)
1. Install XState: `npm install xstate`
2. Create `server/machines/` directory
3. Define `gameRoomMachine.ts` and `playerMachine.ts`
4. Update `GameManager` to use actors internally
5. Keep existing socket handlers but forward to actors
6. **No client changes needed** - server still emits same events

### Phase 2: Socket Event Mapping
1. Map incoming socket events to XState events
2. Subscribe to actor snapshots for outgoing broadcasts
3. Add player actor spawning on game start
4. Test reconnection flow with actor persistence

### Phase 3: Merger Flow Refinement
1. Implement `liquidateShares` substate with player cycling
2. Add `currentMergerPlayerIndex` context tracking
3. Send `MERGER_DECISION_NEEDED` only to current player
4. Test multi-player merger scenarios

### Phase 4: Client Migration (Optional)
1. Add client-side XState machine
2. Replace `useState` with `useMachine`
3. Subscribe to server state changes via machine

### Phase 5: Deployment & Monitoring
1. Add comprehensive logging for state transitions
2. Deploy to Render paid tier ($7/mo) for always-on
3. Add heartbeat mechanism (ping every 25s)
4. Monitor for disconnection causes

---

## Disconnection Handling

### Timeout Strategy
```typescript
// In GameRoomMachine
actions: {
  startDisconnectTimer: assign(({ context, event }) => {
    const timer = setTimeout(() => {
      // Send ABANDON event after 5 minutes
      context.playerActors.get(event.playerId)?.send({ type: 'ABANDON' });
    }, 5 * 60 * 1000);

    context.disconnectTimers.set(event.playerId, timer);
    return context;
  }),

  clearDisconnectTimer: assign(({ context, event }) => {
    const timer = context.disconnectTimers.get(event.playerId);
    if (timer) {
      clearTimeout(timer);
      context.disconnectTimers.delete(event.playerId);
    }
    return context;
  })
}
```

### Reconnection Flow
1. Client reconnects with saved `playerId`
2. Server finds existing PlayerActor via `playerId`
3. Update `socketId` in PlayerActor context
4. Send `RECONNECTED` event to actor
5. Emit `GAME_STATE_SYNC` with full snapshot to client
6. Clear any disconnect timers

---

## Heartbeat System

To prevent Render spin-down:

```typescript
// server/index.ts
const HEARTBEAT_INTERVAL = 25000; // 25 seconds

io.on("connection", (socket) => {
  const heartbeat = setInterval(() => {
    socket.emit("heartbeat", { timestamp: Date.now() });
  }, HEARTBEAT_INTERVAL);

  socket.on("disconnect", () => {
    clearInterval(heartbeat);
  });

  socket.on("heartbeat_ack", () => {
    // Client is alive
  });
});
```

```typescript
// client/context/SocketContext.tsx
useEffect(() => {
  if (!socket) return;

  socket.on("heartbeat", () => {
    socket.emit("heartbeat_ack");
  });
}, [socket]);
```

---

## Testing Strategy

### Unit Tests
- Test state machine transitions in isolation
- Verify guard conditions (e.g., isPlayerTurn)
- Test action assignments (context updates)

### Integration Tests
- Simulate full game flow from lobby → game over
- Test merger flow with multiple players
- Test disconnection/reconnection scenarios
- Test concurrent player actions (should be serialized by actors)

### Load Tests
- Multiple simultaneous games
- Rapid connect/disconnect cycles
- Long-running games (persistence)

---

## Logging & Debugging

Add transition logging:

```typescript
// In machine config
{
  inspect: (event) => {
    if (event.type === "@xstate.snapshot") {
      console.log(`[GameRoom ${gameId}] State:`, event.snapshot.value);
      console.log(`[GameRoom ${gameId}] Context:`, event.snapshot.context);
    }
  }
}
```

Use XState VSCode extension for visualization:
- Install "XState VSCode" extension
- Inspect state machines visually
- Debug transition flows

---

## Rollback Plan

If XState refactor introduces issues:

1. Keep `refactor/xstate-implementation` branch separate
2. Main branch continues with current implementation
3. Feature flag server-side: `USE_XSTATE=false` falls back to old logic
4. Gradual rollout: Enable XState for new games only
5. Monitor error rates and revert if needed

---

## Estimated Timeline

- **Phase 1**: 2-3 days (setup actors, no breaking changes)
- **Phase 2**: 2-3 days (socket event mapping, testing)
- **Phase 3**: 2-3 days (merger flow refinement)
- **Phase 4**: 1-2 days (client migration, optional)
- **Phase 5**: 1 day (deployment, monitoring)

**Total**: ~10-14 days for full implementation

---

## Dependencies

```json
{
  "dependencies": {
    "xstate": "^5.24.0"
  },
  "devDependencies": {
    "@xstate/test": "^1.0.0"  // for testing
  }
}
```

---

## References

- XState Docs: https://xstate.js.org/docs/
- Actor Model: https://xstate.js.org/docs/guides/actors.html
- Parent-Child Communication: https://xstate.js.org/docs/guides/communication.html
- Persistence: https://xstate.js.org/docs/guides/persistence.html

---

## Next Steps

1. Review this plan with team
2. Create detailed task breakdown in GitHub Issues
3. Set up XState development environment
4. Begin Phase 1 implementation
5. Schedule regular check-ins during migration
