// The tile font. Each glyph is a comma-separated list of rows; in the plain
// font '1' is a lit tile and '0' is empty. In the cut font '#' is a full tile,
// '.' is empty, and '1'–'4' lay a triangle into the tile — which corner is
// kept is decided in the shader, from the code carried in the mask's green
// channel. Transcribed from `Tile Concepts.dc.html`.

export const GLYPHS_PLAIN: Record<string, string> = {
  M: '10001,11011,10101,10001,10001,10001,10001',
  A: '01110,10001,10001,11111,10001,10001,10001',
  R: '11110,10001,10001,11110,10100,10010,10001',
  C: '01110,10001,10000,10000,10000,10001,01110',
  O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000',
  L: '10000,10000,10000,10000,10000,10000,11111',
};

export const GLYPHS_CUT: Record<string, string> = {
  M: '3....1,#3..1#,#4312#,#.42.#,#....#,#....#,#....#',
  A: '1###3,#...#,#...#,#####,#...#,#...#,#...#',
  R: '####3,#...#,#...#,####2,#..43,#...#,#...#',
  C: '1###3,#...#,#....,#....,#....,#...#,4###2',
  O: '1###3,#...#,#...#,#...#,#...#,#...#,4###2',
  P: '####3,#...#,#...#,####2,#....,#....,#....',
  L: '#....,#....,#....,#....,#....,#....,#####',
};

/** Tiles across and down. The wordmark is laid out for exactly this grid. */
export const MASK_GRID = { cols: 32, rows: 60 } as const;

/** Where the two words sit in the grid, in tiles. */
export const WORDMARK = [
  { word: 'MARCO', x: 1, y: 12 },
  { word: 'POLO', x: 4, y: 22 },
] as const;
