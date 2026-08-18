import { useEffect, useRef } from 'react';

/** What the CSS clamps the deck to before it has measured itself. */
export const DECK_MIN_PX = 180;

/**
 * The pool deck: the tiled slab across the bottom that carries every control
 * before the game starts. It is also a wall — the lobby's swimmers bounce off
 * its edge — so the water above it has to know exactly how tall it is. Since
 * the deck is clamped by the viewport *and* grows with its contents, no
 * formula predicts that: it measures itself and hands the number over.
 */
export function Deck({
  onHeight,
  children,
}: {
  onHeight?: (px: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(el.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeight]);

  return (
    <div className="deck tiled" ref={ref}>
      {children}
    </div>
  );
}
