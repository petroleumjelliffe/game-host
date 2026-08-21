/**
 * Ask, and be told when nothing answers.
 *
 * `createRoom` is fire-and-forget — no ack, no timeout (see connection.ts) —
 * and socket.io buffers an emit made while disconnected. So a server that is
 * absent rather than refusing sends neither `joined` nor `rejected`, and a
 * screen that waits for one of them waits forever, with the tap swallowed.
 * Every game needs the third outcome: silence, said out loud. Reported from
 * the LAN 2026-08-20; by that evening there were three hand-rolled versions
 * of this, of which two had been written without tests and one of those two
 * was wrong. This is the extraction the backlog deferred until the migration
 * was over (task 3b of the lobby pass).
 *
 * Deliberately *beside* `createLobbyConnection`, not inside it. That
 * interface documents itself as untested on purpose — a test that stubs
 * `io()` restates the file rather than checks it — and a timeout buried in
 * it would inherit the untestability that produced the hand-rolled versions
 * in the first place. This module takes the ask and the two answer channels
 * as arguments and touches no socket, which is what answerTimeout.test.ts
 * exercises with nothing faked but time.
 *
 * Semantics the consumers rely on:
 * - Subscribed before it asks: a synchronous answer (every test fake) is
 *   not missed.
 * - The first answer of either kind cancels the timer; `silence` can no
 *   longer fire.
 * - Answers keep relaying after the timer fires, until `stop`. A `joined`
 *   that limps in at nine seconds — the server came back and flushed the
 *   buffered ask — still seats you; the note it contradicts was an honest
 *   report, not a decision. A consumer that wants the episode over at
 *   silence (Rail Baron does) calls `stop` from its `silence`.
 * - `stop` unsubscribes both channels and clears the timer. Idempotent.
 */

/** How a screen listens to one kind of answer: subscribe, get back "stop". */
export type Subscribe<T> = (handler: (msg: T) => void) => () => void;

/**
 * 8s. Rail Baron's number, which had it from the start and was the only game
 * that did: long enough to cover a deploy's socket drop and the reconnect
 * backoff behind it, short enough that nobody reloads first.
 */
export const NO_ANSWER_MS = 8000;

export function askWithTimeout<J, R>(opts: {
  /** The emit itself — called once, after both channels are subscribed. */
  ask: () => void;
  onJoined: Subscribe<J>;
  onRejected: Subscribe<R>;
  joined: (msg: J) => void;
  rejected: (msg: R) => void;
  /** The third outcome: nothing arrived within `timeoutMs`. */
  silence: () => void;
  timeoutMs?: number;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    opts.silence();
  }, opts.timeoutMs ?? NO_ANSWER_MS);

  const answered = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const offJoined = opts.onJoined((msg) => {
    answered();
    opts.joined(msg);
  });
  const offRejected = opts.onRejected((msg) => {
    answered();
    opts.rejected(msg);
  });

  opts.ask();

  return () => {
    answered();
    offJoined();
    offRejected();
  };
}
