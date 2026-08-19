import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CatalogPage from './CatalogPage';
import { SECTIONS } from './sections';

describe('CatalogPage', () => {
  // A smoke pass over the whole inventory: every state in the catalog renders.
  // The catalog is not an assertion surface — no snapshots, which churn during
  // a from-scratch rebuild and then get blind-approved — but "it renders at
  // all" is worth pinning, since a throw here takes the whole page down.
  it('renders the entire catalog without throwing', () => {
    expect(() => render(<CatalogPage />)).not.toThrow();
  });

  // By role, not by text: a section title like "Place a tile" is also the label
  // of the ActiveStep inside it, and a bare getByText matches both.
  it('renders every section heading', () => {
    render(<CatalogPage />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    for (const section of SECTIONS) {
      expect(headings.some((h) => h.includes(section.title)), `no heading for "${section.title}"`).toBe(
        true,
      );
    }
  });

  it('has no empty section', () => {
    for (const section of SECTIONS) {
      expect(section.states.length, `section "${section.title}" is empty`).toBeGreaterThan(0);
    }
  });

  it('renders a card for every state in every section', () => {
    const { container } = render(<CatalogPage />);
    const total = SECTIONS.reduce((n, s) => n + s.states.length, 0);
    expect(container.querySelectorAll('[data-catalog-state]')).toHaveLength(total);
  });

  // Nobody should be able to mistake an authored fixture for engine-verified
  // truth, so every caption says which it is — and a golden one names its game.
  it('captions each golden state with its game id and step', () => {
    const { container } = render(<CatalogPage />);
    for (const section of SECTIONS) {
      for (const state of section.states) {
        if (state.fixture.source !== 'golden') continue;
        const card = container.querySelector(`[data-catalog-state="${state.label}"]`) as HTMLElement;
        expect(
          within(card).getByText(`${state.fixture.gameId} · step ${state.fixture.stepIndex}`),
        ).toBeInTheDocument();
      }
    }
  });

  it('marks each authored state as authored', () => {
    const { container } = render(<CatalogPage />);
    for (const section of SECTIONS) {
      for (const state of section.states) {
        if (state.fixture.source !== 'authored') continue;
        const card = container.querySelector(`[data-catalog-state="${state.label}"]`) as HTMLElement;
        expect(card.querySelector('[data-source="authored"]')).toBeTruthy();
      }
    }
  });

  it('sources the turn-step sections from golden games, not by hand', () => {
    const turnSteps = SECTIONS.filter((s) => /^\d+$/.test(s.seq));
    expect(turnSteps.length).toBeGreaterThan(0);
    for (const section of turnSteps) {
      const golden = section.states.filter((s) => s.fixture.source === 'golden');
      expect(golden.length, `section "${section.title}" has no engine-backed state`).toBeGreaterThan(0);
    }
  });
});
