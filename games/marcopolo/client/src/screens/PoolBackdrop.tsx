import { useEffect, useRef } from 'react';
import { createTileFloor, MAX_DPR, type TileMask, type TileSkin } from '../render/tiles';
import { poolLayout, type PoolLayout } from '../render/scene';

// The water is one continuous body across the whole session: phase is measured
// from when the app started, not from when a screen mounted, so navigating
// between screens does not snap the waves back to flat.
const EPOCH = performance.now();

export interface PoolBackdropProps {
  skin: TileSkin;
  mask: TileMask;
  /**
   * Painted onto the 2D layer every frame, over the tiles. Given the layout so
   * callers do not each re-derive where the arena sits.
   */
  paint?: (ctx: CanvasRenderingContext2D, layout: PoolLayout, now: number) => void;
  children?: React.ReactNode;
}

/**
 * The water, on every screen: the tile shader below, a 2D layer above it for
 * anything that swims, and the screen's own chrome on top of both. One render
 * loop drives all three so the warp and the swimmers never tear apart.
 */
export function PoolBackdrop({ skin, mask, paint, children }: PoolBackdropProps) {
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Read through refs inside the loop: a prop change must not restart it.
  const frameRef = useRef({ skin, mask, paint });
  frameRef.current = { skin, mask, paint };

  useEffect(() => {
    const host = hostRef.current!;
    const glCanvas = glRef.current!;
    const scene = sceneRef.current!;
    let floor = createTileFloor(glCanvas);
    if (!floor) host.classList.add('pool--fallback');

    // Backgrounding a tab or a GPU reset kills the context and every object
    // in it, and a phone at a party does both. Nothing in a dead floor is
    // salvageable, so the restore is to build another one; preventDefault on
    // the loss is what makes the browser offer a restore at all.
    const onLost = (e: Event) => {
      e.preventDefault();
      floor = null;
      host.classList.add('pool--fallback');
    };
    const onRestored = () => {
      floor = createTileFloor(glCanvas);
      if (floor) host.classList.remove('pool--fallback');
    };
    glCanvas.addEventListener('webglcontextlost', onLost);
    glCanvas.addEventListener('webglcontextrestored', onRestored);

    const ctx = scene.getContext('2d');
    let raf = 0;

    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const layout = poolLayout(w, h);
      const now = performance.now();

      // Before layout settles there is no arena to draw into, and painters
      // divide by its size.
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(frame);
        return;
      }

      floor?.resize(w, h, dpr);
      floor?.render({ time: (now - EPOCH) / 1000, ...frameRef.current });

      if (ctx) {
        const scale = Math.min(dpr, MAX_DPR);
        const bw = Math.round(w * scale);
        const bh = Math.round(h * scale);
        if (scene.width !== bw || scene.height !== bh) {
          scene.width = bw;
          scene.height = bh;
        }
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, w, h);
        frameRef.current.paint?.(ctx, layout, now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      glCanvas.removeEventListener('webglcontextlost', onLost);
      glCanvas.removeEventListener('webglcontextrestored', onRestored);
      floor?.dispose();
    };
  }, []);

  return (
    <div ref={hostRef} className={skin === 'blind' ? 'pool pool--blind' : 'pool'}>
      <canvas ref={glRef} />
      <canvas ref={sceneRef} />
      {children}
    </div>
  );
}
