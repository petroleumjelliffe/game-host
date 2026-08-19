import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StagingZone } from './StagingZone';
import { StockStack } from '../atoms/StockStack';

/** jsdom reports 0 for real layout, so assert the reservations structurally. */
function classesOf(el: Element | null | undefined): string {
  return el?.className ?? '';
}

describe('StagingZone height stability', () => {
  it('reserves the pile height whether empty or filled', () => {
    const { container: empty } = render(<StagingZone label="Staging" />);
    const { container: full } = render(
      <StagingZone label="Staging" shares={<StockStack id="Messla" count={2} price={300} size="sm" />} />,
    );
    const pileOf = (c: HTMLElement) => c.querySelector('[data-zone="pile"]');
    expect(classesOf(pileOf(empty))).toMatch(/min-h-/);
    expect(classesOf(pileOf(empty))).toBe(classesOf(pileOf(full)));
  });

  it('always renders the Net total, muted at zero', () => {
    const { container } = render(<StagingZone label="Staging" cashDelta={0} />);
    const net = container.querySelector('[data-zone="net"]');
    expect(net).toBeTruthy();
    expect(net?.textContent).toContain('$0');
  });

  it('always reserves the action slot, with or without a button', () => {
    const { container: without } = render(<StagingZone label="Staging" />);
    const { container: withBtn } = render(<StagingZone label="Staging" action={<button>Go</button>} />);
    const slotOf = (c: HTMLElement) => c.querySelector('[data-zone="action"]');
    expect(slotOf(without)).toBeTruthy();
    expect(classesOf(slotOf(without))).toMatch(/min-h-/);
    expect(classesOf(slotOf(without))).toBe(classesOf(slotOf(withBtn)));
  });
});
