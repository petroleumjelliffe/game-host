import type { SeatId } from '../state/events';

export const TOKENS = {
  board: '#0a0a0a',
  bezel: '#1b1b1b',
  header: '#151515',
  rule: '#1c1c1c',
  amber: '#f5c451',
  pale: '#cfc9ba',
  dim: '#6f6a5e',
  flapTop: '#1e1e1e',
  flapBottom: '#151515',
  tileWidth: 30,
  tileHeight: 40,
  tileGap: 1
} as const;

export const SEAT_COLORS: Record<SeatId, string> = {
  red: '#e02b1d',
  green: '#5fbb2e',
  blue: '#2f7fe8',
  yellow: '#f0b429',
  black: '#1d1d1d',
  white: '#f2efe6'
};
