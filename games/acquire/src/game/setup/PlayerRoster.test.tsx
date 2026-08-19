import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlayerRoster, avatarFor } from './PlayerRoster';
import { PLAYER_EMOJI } from '../../../engine/startups';

const TWO = [{ name: 'Alex' }, { name: 'Sam' }];

describe('PlayerRoster', () => {
  it('renders one row per seat with its avatar', () => {
    render(<PlayerRoster seats={TWO} onChange={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(PLAYER_EMOJI[0]!)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(PLAYER_EMOJI[1]!)).toBeInTheDocument();
  });

  it('assigns avatars by seat index', () => {
    expect(avatarFor(0)).toBe(PLAYER_EMOJI[0]);
    expect(avatarFor(5)).toBe(PLAYER_EMOJI[5]);
  });

  it('edits a seat name', () => {
    const onChange = vi.fn();
    render(<PlayerRoster seats={TWO} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Alex'), { target: { value: 'Alexandra' } });
    expect(onChange).toHaveBeenCalledWith([{ name: 'Alexandra' }, { name: 'Sam' }]);
  });

  it('adds a seat', () => {
    const onChange = vi.fn();
    render(<PlayerRoster seats={TWO} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add player/i }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'Alex' }, { name: 'Sam' }, { name: 'Player 3' }]);
  });

  it('removes a seat', () => {
    const onChange = vi.fn();
    render(<PlayerRoster seats={[{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }]} onChange={onChange} />);
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(within(rows[1]!).getByRole('button', { name: /remove sam/i }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'Alex' }, { name: 'Jo' }]);
  });

  it('cannot add beyond six seats', () => {
    const six = PLAYER_EMOJI.map((_, i) => ({ name: `P${i + 1}` }));
    render(<PlayerRoster seats={six} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /add player/i })).toBeDisabled();
  });

  it('cannot remove below two seats', () => {
    render(<PlayerRoster seats={TWO} onChange={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByRole('button', { name: /remove alex/i })).toBeDisabled();
  });
});
