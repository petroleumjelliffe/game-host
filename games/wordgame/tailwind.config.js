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
        board: { DEFAULT: '#1e4d3b', cell: '#ecf2e9', 'cell-ink': '#9db2a4' },
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
