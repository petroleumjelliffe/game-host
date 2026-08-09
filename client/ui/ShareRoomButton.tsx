// src/lobby/ui/ShareRoomButton.tsx
// One tap: copy the room link, then open the native share sheet where the
// platform has one. Copy comes FIRST so the link survives a dismissed sheet.
//
// The kit never computes URLs — the game hands one in, which keeps this
// component route-agnostic. The share *text* rides an optional prop with a
// game-neutral default, so wording is a call-site edit, never a kit change.

import { useEffect, useRef, useState } from 'react';

export interface ShareRoomButtonProps {
  /** The room link. The clipboard gets exactly this — pasted links should be links. */
  url: string;
  /** Share-sheet text beside the link. Defaults game-neutral; games override. */
  text?: string;
}

/** How long the copy-only fallback says "Copied" before the label reverts. */
const COPIED_MS = 2000;

export function ShareRoomButton({ url, text = 'Join my game room' }: ShareRoomButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  async function share(): Promise<void> {
    // Guarded like identity.ts's storage reads: every branch that can throw is
    // wrapped, and failure degrades to whatever still works. A lobby that
    // throws on a share tap is worse than a share that quietly only copied.
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      // No clipboard permission: the sheet below may still work.
    }

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, text });
      } catch {
        // A dismissed sheet (AbortError) is a choice, not an error — and the
        // copy already happened, so there is nothing to recover.
      }
      return;
    }

    // No sheet on this platform: the copy is the whole action, so say it
    // happened. A text swap, not an animation — nothing for reduced-motion
    // to object to.
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setCopied(false); }, COPIED_MS);
  }

  return (
    <button
      type="button"
      onClick={() => { void share(); }}
      className="m-0 w-full rounded-lg border border-[var(--lobby-accent,#2563eb)] px-4 py-2 font-semibold text-[var(--lobby-accent,#2563eb)] hover:bg-gray-50"
    >
      {copied ? 'Copied' : 'Share link'}
    </button>
  );
}
