import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_ANSWER_MS, askWithTimeout, type Subscribe } from './answerTimeout';

/** A bare answer channel: a set of handlers and a way to fire them. */
function channel<T>() {
  const handlers = new Set<(msg: T) => void>();
  const subscribe: Subscribe<T> = (handler) => {
    handlers.add(handler);
    return () => { handlers.delete(handler); };
  };
  return { subscribe, fire: (msg: T) => { for (const h of [...handlers]) h(msg); }, handlers };
}

function harness(timeoutMs?: number) {
  const joinedChannel = channel<{ roomId: string }>();
  const rejectedChannel = channel<{ message: string }>();
  const seen = { asked: 0, joined: [] as { roomId: string }[], rejected: [] as { message: string }[], silences: 0 };
  const stop = askWithTimeout({
    ask: () => { seen.asked += 1; },
    onJoined: joinedChannel.subscribe,
    onRejected: rejectedChannel.subscribe,
    joined: (msg) => seen.joined.push(msg),
    rejected: (msg) => seen.rejected.push(msg),
    silence: () => { seen.silences += 1; },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { joinedChannel, rejectedChannel, seen, stop };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('askWithTimeout', () => {
  it('asks exactly once, and only after both channels are live', () => {
    vi.useFakeTimers();
    const joinedChannel = channel<unknown>();
    const rejectedChannel = channel<unknown>();
    let subscribedWhenAsked = 0;
    askWithTimeout({
      ask: () => { subscribedWhenAsked = joinedChannel.handlers.size + rejectedChannel.handlers.size; },
      onJoined: joinedChannel.subscribe,
      onRejected: rejectedChannel.subscribe,
      joined: () => {},
      rejected: () => {},
      silence: () => {},
    });
    // A fake that answers synchronously from inside ask() must be heard.
    expect(subscribedWhenAsked).toBe(2);
  });

  it('says nothing before the deadline and silence exactly once at it', () => {
    vi.useFakeTimers();
    const { seen } = harness();
    vi.advanceTimersByTime(NO_ANSWER_MS - 1);
    expect(seen.silences).toBe(0);
    vi.advanceTimersByTime(1);
    expect(seen.silences).toBe(1);
    vi.advanceTimersByTime(NO_ANSWER_MS * 10);
    expect(seen.silences).toBe(1);
  });

  it('a joined answer relays and disarms the timer', () => {
    vi.useFakeTimers();
    const { joinedChannel, seen } = harness();
    joinedChannel.fire({ roomId: 'ABCDEF' });
    expect(seen.joined).toEqual([{ roomId: 'ABCDEF' }]);
    vi.advanceTimersByTime(NO_ANSWER_MS * 2);
    expect(seen.silences).toBe(0);
  });

  it('a rejection is an answer too', () => {
    vi.useFakeTimers();
    const { rejectedChannel, seen } = harness();
    rejectedChannel.fire({ message: 'room is full' });
    expect(seen.rejected).toEqual([{ message: 'room is full' }]);
    vi.advanceTimersByTime(NO_ANSWER_MS * 2);
    expect(seen.silences).toBe(0);
  });

  it('still relays an answer that limps in after the silence', () => {
    // The server came back and flushed the buffered ask: the room exists and
    // the player should land in it, note or no note.
    vi.useFakeTimers();
    const { joinedChannel, seen } = harness();
    vi.advanceTimersByTime(NO_ANSWER_MS);
    expect(seen.silences).toBe(1);
    joinedChannel.fire({ roomId: 'ABCDEF' });
    expect(seen.joined).toEqual([{ roomId: 'ABCDEF' }]);
  });

  it('stop unsubscribes both channels and disarms the timer', () => {
    vi.useFakeTimers();
    const { joinedChannel, rejectedChannel, seen, stop } = harness();
    stop();
    expect(joinedChannel.handlers.size).toBe(0);
    expect(rejectedChannel.handlers.size).toBe(0);
    vi.advanceTimersByTime(NO_ANSWER_MS * 2);
    expect(seen.silences).toBe(0);
    stop(); // idempotent
  });

  it('honours a caller-chosen deadline', () => {
    vi.useFakeTimers();
    const { seen } = harness(100);
    vi.advanceTimersByTime(100);
    expect(seen.silences).toBe(1);
  });
});
