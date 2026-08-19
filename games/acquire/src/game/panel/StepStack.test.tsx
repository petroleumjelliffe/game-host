import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StepStack } from './StepStack';
import { ActiveStep } from './ActiveStep';

// Every entry is a real undo point here; the `undoable` flag's own behaviour is
// covered by 'offers undo only on entries marked undoable' below.
const ENTRIES = [
  { stepId: 1, phase: 'Place a tile', detail: <span>Alex played E6</span>, undoable: true },
  { stepId: 2, phase: 'Found a startup', detail: <span>Messla founded</span>, undoable: true },
  { stepId: 3, phase: 'Buy shares', detail: <span>2 × Messla</span>, undoable: true },
];

describe('StepStack', () => {
  it('renders the entries in order', () => {
    const { container } = render(<StepStack entries={ENTRIES} />);
    const phases = Array.from(container.querySelectorAll('[data-step-phase]')).map(
      (el) => el.textContent,
    );
    expect(phases).toEqual(['Place a tile', 'Found a startup', 'Buy shares']);
  });

  // The undo affordance is what makes a completed step a rewind point. It is
  // present exactly when a caller can act on it, which is how the catalog shows
  // the undoable and the read-only appearance from one component.
  it('renders one undo control per undoable entry when onUndo is supplied', () => {
    const { container } = render(<StepStack entries={ENTRIES} onUndo={() => {}} />);
    expect(container.querySelectorAll('[data-step-undo]')).toHaveLength(ENTRIES.length);
  });

  it('renders no undo control at all when onUndo is not supplied', () => {
    const { container } = render(<StepStack entries={ENTRIES} />);
    expect(container.querySelectorAll('[data-step-undo]')).toHaveLength(0);
  });

  /**
   * The stack has no motion of its own, and this pins that as a postcondition
   * rather than an omission. It moves because the active zone below it grows
   * and pushes it — the stack's bottom edge is that zone's top edge — which is
   * one motion, on one element, instead of two things kept in sync.
   *
   * Two earlier attempts animated this list directly, both shipped green, and
   * both were wrong in the same way. If a transform or an animation class comes
   * back here, it is that mistake returning.
   */
  it('has no motion of its own', () => {
    const { container } = render(<StepStack entries={ENTRIES} />);
    const list = container.querySelector('[data-step-list]')!;
    expect(list.querySelectorAll('[data-step-phase]')).toHaveLength(ENTRIES.length);
    expect(list.getAttribute('style') ?? '').not.toMatch(/transform|transition/);
    expect(container.querySelectorAll('.step-enter, .active-step-enter')).toHaveLength(0);
  });

  // stepId is the entry's identity — the same id Plan 1a's rewindTo takes —
  // so undo must call back with that step's own id, not its array index.
  it('calls back with that entry own stepId', () => {
    const onUndo = vi.fn();
    const { container } = render(<StepStack entries={ENTRIES} onUndo={onUndo} />);
    const second = container.querySelectorAll('[data-step-undo]')[1];
    fireEvent.click(second!);
    expect(onUndo).toHaveBeenCalledWith(2);
  });
});

describe('ActiveStep', () => {
  it('renders its label and body', () => {
    render(<ActiveStep label="Buy shares" body={<p>Pick up to three</p>} />);
    expect(screen.getByText('Buy shares')).toBeInTheDocument();
    expect(screen.getByText('Pick up to three')).toBeInTheDocument();
  });

  it('renders the button slot only when one is supplied', () => {
    const { container: withBtn } = render(
      <ActiveStep label="Buy shares" body={<p>body</p>} button={<button>Done</button>} />,
    );
    expect(within(withBtn).getByRole('button', { name: 'Done' })).toBeInTheDocument();

    const { container: without } = render(<ActiveStep label="Buy shares" body={<p>body</p>} />);
    expect(without.querySelector('button')).toBeFalsy();
  });
});

it('offers undo only on entries marked undoable', () => {
  const onUndo = vi.fn();
  render(
    <StepStack
      onUndo={onUndo}
      entries={[
        { stepId: 1, phase: 'Placed a tile', detail: 'E5', undoable: true },
        { stepId: 2, phase: 'Merger payout', detail: 'paid', undoable: false },
      ]}
    />,
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
