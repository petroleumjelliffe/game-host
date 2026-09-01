/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#e9e5da',
        paper: '#f7f4ec',
        ink: { DEFAULT: '#2b2820', soft: '#5f5744', mute: '#7a7361', faint: '#8a8271', ghost: '#a39a85' },
        line: { DEFAULT: '#e0d9c8', strong: '#d8d0bd' },
        hairline: '#e3ddcf',
        chipbg: '#ded7c5',
        accent: { DEFAULT: '#2563eb', strong: '#1d4ed8' },
        tile: { DEFAULT: '#f7ebc8', edge: '#d9bf8a', ink: '#5f4a1d', blank: '#a08a4a' },
        // The "linen" board theme (Word Game Hi-Fi.dc.html, 2026-09-01):
        // light frame with a hairline border, near-paper empty cells. The
        // old forest green lives only in git history now.
        board: { DEFAULT: '#e7e0d0', frame: '#cfc7b4', cell: '#faf8f2', 'cell-ink': '#b8b0a0' },
        prem: {
          '3w': '#d05a41',
          '2w': '#f2c9bd', '2w-ink': '#a04b33',
          '3l': '#3f88ba',
          '2l': '#b9d8ea', '2l-ink': '#33698f',
        },
        gold: '#e0a924',
        warnbg: '#fdf3e0', warnbd: '#e3c88a',
        warn: { ink: '#8a5f10', accent: '#c98a1e' },
        danger: { DEFAULT: '#d05a41', ink: '#b34430' },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        tile: ['Bitter', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
