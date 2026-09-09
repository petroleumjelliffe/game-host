// The unwrap exists because both failure shapes were hit live within two
// days: a WebPushError whose String() hid the status code (2026-09-07), and
// an AggregateError whose String() was the bare class name with every errno
// inside .errors (2026-09-09).

import { describeSendError } from './webPush.js';

describe('describeSendError', () => {
  test('flattens an AggregateError into its per-attempt errnos', () => {
    const v4 = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });
    const v6 = Object.assign(new Error('connect ECONNREFUSED ::1:443'), {
      code: 'ECONNREFUSED',
    });
    const aggregate = new AggregateError([v4, v6], '');
    const described = describeSendError(aggregate);
    expect(described).toContain('ECONNREFUSED connect ECONNREFUSED 127.0.0.1:443');
    expect(described).toContain('::1:443');
    // The bare class name — what the log line used to say — never suffices.
    expect(described).not.toBe('AggregateError');
  });

  test('follows a cause chain', () => {
    const root = Object.assign(new Error('getaddrinfo ENOTFOUND web.push.apple.com'), {
      code: 'ENOTFOUND',
    });
    const wrapped = new Error('fetch failed', { cause: root });
    expect(describeSendError(wrapped)).toBe(
      'fetch failed (cause: ENOTFOUND getaddrinfo ENOTFOUND web.push.apple.com)',
    );
  });

  test('plain errors pass through', () => {
    expect(describeSendError(new Error('boom'))).toBe('boom');
  });
});
