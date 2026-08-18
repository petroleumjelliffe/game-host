import { useRef, useState } from 'react';
import { navigateHome, navigateToRoom } from '../router';
import { drawIdlePool } from '../render/idle';
import { PoolBackdrop } from './PoolBackdrop';
import { Deck, DECK_MIN_PX } from './Deck';

const CODE_LENGTH = 6;
// The lobby's alphabet: no I, O, 0 or 1 to mistype across a room.
const ALPHABET = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/;
const DECOR = [{ seat: 1, id: 'p2' }, { seat: 4, id: 'p5' }, { seat: 7, id: 'p8' }];

export function JoinScreen() {
  const [code, setCode] = useState('');
  const [deckHeight, setDeckHeight] = useState(DECK_MIN_PX);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? null);

  const accept = (raw: string) =>
    setCode([...raw.toUpperCase()].filter((c) => ALPHABET.test(c)).slice(0, CODE_LENGTH).join(''));

  return (
    <main>
      <PoolBackdrop
        skin="pale"
        mask="cut"
        paint={(ctx, layout, now) => {
          const height = layout.size + layout.offsetY * 2;
          const width = layout.size + layout.offsetX * 2;
          drawIdlePool(
            ctx,
            DECOR,
            { left: 0, top: 0, right: width, bottom: height - deckHeight },
            now,
            Math.max(18, width * 0.062),
          );
        }}
      >
        <div className="chips">
          <button className="chip chip--light chip--action" onClick={() => navigateHome()}>
            ← JOIN A GAME
          </button>
          <span className="chip chip--dark">CODE FROM HOST</span>
        </div>
        <Deck onHeight={setDeckHeight}>
          <span className="deck__label">ROOM CODE</span>
          <div className="code" onClick={() => inputRef.current?.focus()}>
            <input
              ref={inputRef}
              className="code__input"
              value={code}
              onChange={(e) => accept(e.target.value)}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              aria-label="Room code"
              autoFocus
            />
            {boxes.map((ch, i) => (
              <span key={i} className={ch ? 'code__box' : 'code__box code__box--empty'}>
                {ch ?? (i === code.length ? <span className="code__caret" /> : null)}
              </span>
            ))}
          </div>
          <div className="code__hint">
            <span>TYPE {CODE_LENGTH} CHARACTERS</span>
          </div>
          <div className="deck__footer">
            <button
              className="btn btn--primary btn--center"
              disabled={code.length < CODE_LENGTH}
              onClick={() => navigateToRoom(code)}
            >
              JOIN
            </button>
          </div>
        </Deck>
      </PoolBackdrop>
    </main>
  );
}
