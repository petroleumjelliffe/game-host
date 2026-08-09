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

  function showCopied(): void {
    // A text swap, not an animation — nothing for reduced-motion to object to.
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setCopied(false); }, COPIED_MS);
  }

  function share(): void {
    // Copy and sheet start in the SAME gesture tick — no await between the
    // click and `navigator.share`. Safari spends the click's user activation
    // on whatever is called during it; awaiting the clipboard first burned
    // the activation and the sheet was refused with `NotAllowedError`, which
    // the old silent catch then swallowed. Found by hand in Safari on
    // 2026-08-09; Chrome's laxer activation window hid it. Guarded like
    // identity.ts's storage reads throughout: failure degrades to whatever
    // still works.
    const copy: Promise<void> = (async () => {
      await navigator.clipboard?.writeText(url);
    })();
    const copiedThenSay = (): void => {
      // Only claim "Copied" if the write actually landed; a clipboard that
      // refused has nothing to announce, and lying about it is worse.
      copy.then(showCopied).catch(() => {});
    };

    if (typeof navigator.share === 'function') {
      navigator.share({ url, text }).catch((e: unknown) => {
        // A dismissed sheet (AbortError) is a choice, not an error — and the
        // copy already happened, so there is nothing to recover. Any OTHER
        // refusal means no sheet ever showed, so the copy is the whole
        // action: say it happened.
        if (e instanceof DOMException && e.name === 'AbortError') return;
        copiedThenSay();
      });
      return;
    }

    // No sheet on this platform (desktop Firefox, most desktop browsers):
    // the copy is the whole action, so say it happened.
    copiedThenSay();
  }

  return (
    <button
      type="button"
      onClick={share}
      className="m-0 w-full rounded-lg border border-[var(--lobby-accent,#2563eb)] px-4 py-2 font-semibold text-[var(--lobby-accent,#2563eb)] hover:bg-gray-50"
    >
      {copied ? 'Copied' : 'Share link'}
    </button>
  );
}
