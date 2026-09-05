// packages/notify/fromEnv.ts
// Boot-time assembly: env in, a running service out. This is the only file
// the composed host needs to call; everything it reads is documented beside
// the channel that reads it (webPush.ts, email.ts), plus:
//
//   NOTIFY_ORIGIN       absolute origin for links in emails
//                       (e.g. https://games.example.com); email stays off
//                       without it even when SMTP is configured
//   NOTIFY_DEBOUNCE_MS  how long a player must be away after their turn
//                       starts before anything sends (default 60000)
//
// All secrets come from env vars, none committed — the acceptance criterion,
// held by construction: nothing in this package reads anything else.

import { createNotifyService, DEFAULT_DEBOUNCE_MS, type NotifyService } from './service.js';
import type { NotifyChannels } from './channels.js';
import { emailSenderFromEnv } from './email.js';
import { pushSenderFromEnv } from './webPush.js';

export async function createNotifyServiceFromEnv(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = (line) => console.log(line),
  /**
   * Test-only channel injection: the composed host builds its service from
   * env alone, which left the fake channels unreachable from the one test
   * that proves an invite end to end. Given, it replaces the env-built
   * channels entirely; production callers never pass it.
   */
  channels?: NotifyChannels,
): Promise<NotifyService> {
  const debounceRaw = Number(env.NOTIFY_DEBOUNCE_MS);
  const debounceMs =
    Number.isFinite(debounceRaw) && debounceRaw >= 0 ? debounceRaw : DEFAULT_DEBOUNCE_MS;
  const origin = env.NOTIFY_ORIGIN?.trim() || undefined;
  let built: NotifyChannels;
  if (channels !== undefined) {
    built = channels;
  } else {
    const [push, email] = await Promise.all([
      pushSenderFromEnv(env, log),
      emailSenderFromEnv(env, log),
    ]);
    built = { push, email };
  }
  if (built.email && !origin) {
    log('! SMTP is configured but NOTIFY_ORIGIN is not — email notifications stay off');
  }
  return createNotifyService({ dataDir, debounceMs, origin, channels: built, log });
}
