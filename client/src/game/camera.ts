// World: circle of radius 1 at the origin, y up-negative like canvas.
// Screen: a square canvas of `size` px; the arena inscribes it exactly.

export function worldToScreen(wx: number, wy: number, size: number): { x: number; y: number } {
  return { x: ((wx + 1) / 2) * size, y: ((wy + 1) / 2) * size };
}

export function screenToWorld(sx: number, sy: number, size: number): { x: number; y: number } {
  return { x: (sx / size) * 2 - 1, y: (sy / size) * 2 - 1 };
}

export function worldScale(w: number, size: number): number {
  return (w * size) / 2;
}
