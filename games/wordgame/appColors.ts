// The two colors the PWA machinery needs, in one root-level copy — the same
// consolidation as basePath.ts. vite.config.ts (the index.html theme-color
// placeholder) and scripts/generate-manifest.ts both read these; tailwind's
// `page` token carries the same value and is where the palette actually
// lives, so a reskin edits tailwind.config.js and this file together.
export const THEME_COLOR = '#e9e5da';
export const BACKGROUND_COLOR = '#e9e5da';
