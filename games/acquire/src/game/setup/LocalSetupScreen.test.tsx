import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalSetupScreen } from './LocalSetupScreen';

describe('LocalSetupScreen', () => {
  it('starts with two seats', () => {
    render(<LocalSetupScreen onStart={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('reports the seat names on start', () => {
    const onStart = vi.fn();
    render(<LocalSetupScreen onStart={onStart} defaultSeed="fixed-seed" />);
    fireEvent.change(screen.getByDisplayValue('Player 1'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByDisplayValue('Player 2'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));

    expect(onStart).toHaveBeenCalledWith({ seed: 'fixed-seed', names: ['Alex', 'Sam'] });
  });

  it('keeps the seed out of the way but reachable', () => {
    render(<LocalSetupScreen onStart={() => {}} defaultSeed="fixed-seed" />);
    expect(screen.getByText(/advanced/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('fixed-seed')).toBeInTheDocument();
  });

  it('refuses to start when a seat has no name', () => {
    render(<LocalSetupScreen onStart={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('Player 1'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
  });

  it('prefills the roster it is given, one seat per name', () => {
    render(<LocalSetupScreen onStart={() => {}} initialNames={['Ada', 'Grace', 'Alan']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByDisplayValue('Ada')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Grace')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alan')).toBeInTheDocument();
  });

  it('generates a different seed each mount so two games differ', () => {
    const { unmount } = render(<LocalSetupScreen onStart={() => {}} />);
    const first = (screen.getByLabelText(/seed/i) as HTMLInputElement).value;
    unmount();
    render(<LocalSetupScreen onStart={() => {}} />);
    const second = (screen.getByLabelText(/seed/i) as HTMLInputElement).value;
    expect(first).not.toBe(second);
  });
});
