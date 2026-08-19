# ADR 001: Board Visibility Improvements

**Date:** 2024-11-29
**Status:** Proposed
**Deciders:** Development Team

## Context

The current UI has several visibility issues that hinder gameplay experience:

1. **Overlays block board view**: When waiting for another player's turn, a full-screen overlay completely blocks the board, preventing players from viewing the game state
2. **Buy phase blocks board**: The buy shares modal centers on screen and completely obscures the board, making it difficult to make informed purchasing decisions
3. **Found startup modal blocks board**: Similar to buy phase, founding a startup requires viewing the board to understand chain placement
4. **No visual feedback for chain changes**: Newly placed tiles and chain growth are not visually highlighted, making it hard to track game progress

## Decision

We will implement the following improvements to enhance board visibility:

### 1. Replace Overlay with Banner for Turn Indication

**Change**: Convert `WaitingForPlayer` component from full-screen overlay to top banner
- **Before**: Full-screen semi-transparent overlay (`fixed inset-0 bg-black/40`) with centered card
- **After**: Fixed top banner (`fixed top-16`) with compact, non-intrusive design
- **Benefit**: Board remains visible while still clearly indicating whose turn it is
- **Implementation**: Gradient banner (blue-600 to blue-700) with player name, connection status, and animated dots

### 2. Pin Modals to Bottom of Screen

**Modals Affected**:
- `BuyModal`: Share purchasing interface
- `FoundStartupModal`: Startup selection interface

**Changes**:
- Position modals at bottom of viewport (`fixed bottom-0`) instead of center
- Allow board scrolling behind modal
- Ensure player hand at bottom can scroll above modal
- Reduce modal height to ~30-40% of viewport

**Benefits**:
- Players can view entire board while making decisions
- Scrollable content ensures accessibility
- Maintains focus on game state during decision-making

### 3. Optimize Buy Modal Layout

**Changes**:
- Reduce startup cards by 25% in size
- Arrange available stocks and 3 purchase slots in single horizontal row
- Make modal content scrollable if needed
- Pin to bottom with transparent backdrop allowing board view

**Benefits**:
- More compact UI
- All purchase options visible at once
- Better use of horizontal screen space

### 4. Visual Highlighting for Chain Changes

**Changes** (Future enhancement):
- Highlight newly placed tiles with subtle animation/glow
- Highlight chains that grew this turn
- Fade highlighting after a few seconds

**Benefits**:
- Clear visual feedback for game state changes
- Easier to track chain growth and mergers
- Improved understanding of board dynamics

### 5. Board Interaction Prevention Without Overlay

**Change**: Prevent board interaction when not player's turn without using overlay
- Add `pointer-events-none` to board tiles when `!isMyTurn`
- Visual indication through banner, not blocking overlay
- Board remains visible for observation

**Benefits**:
- Clear visibility of game state
- Obvious turn indication through banner
- Cannot accidentally interact during opponent's turn

## Consequences

### Positive

- **Improved visibility**: Players can always see the full board
- **Better decision-making**: Buy/found decisions informed by visible board state
- **Reduced frustration**: No more blind purchasing or founding
- **Cleaner UI**: Banner is less intrusive than full-screen overlay
- **Mobile-friendly**: Bottom-pinned modals work well on mobile devices

### Negative

- **Requires scroll on short screens**: Some users may need to scroll to see both modal and full board
- **Less obvious turn indicator**: Banner is subtler than full-screen overlay (mitigated by clear styling)
- **Layout complexity**: Bottom-pinned modals require more complex CSS and scroll handling

### Neutral

- **Design consistency**: Need to ensure all modals follow similar patterns
- **Animation timing**: Highlight timings need tuning for best UX

## Implementation Plan

1. Update `WaitingForPlayer` component to banner design
2. Add `pointer-events-none` logic to board when not player's turn
3. Refactor `BuyModal`:
   - Change positioning to bottom-pinned
   - Reduce card sizes
   - Optimize layout for single-row purchase interface
4. Refactor `FoundStartupModal`:
   - Change positioning to bottom-pinned
   - Adjust layout for better visibility
5. (Future) Add chain growth highlighting
6. Test on various screen sizes
7. Verify multiplayer interaction

## Alternatives Considered

### Alternative 1: Transparent Overlay
- Make overlay 90% transparent instead of removing it
- **Rejected**: Still blocks interaction and reduces clarity

### Alternative 2: Sidebar Modals
- Pin modals to left or right side instead of bottom
- **Rejected**: Takes away horizontal board space, worse on mobile

### Alternative 3: Floating Modals
- Small draggable modals that can be moved around
- **Rejected**: Too complex, poor mobile experience, accessibility concerns

### Alternative 4: Split Screen
- Divide screen into board view and action panel
- **Rejected**: Reduces board size significantly, poor use of space

## References

- Original issue: Players unable to see board during buy phase
- User feedback: "Can't make good purchasing decisions without seeing the board"
- Design principle: Information should be visible when needed for decision-making
