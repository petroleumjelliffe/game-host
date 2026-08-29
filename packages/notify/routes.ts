// packages/notify/routes.ts
// The HTTP face of the notification service, mounted by the host under
// /notify — a host-level path, registered before any game so no SPA
// fallback can shadow it, and colliding with no game's base path.
//
// Everything a browser does is a POST carrying the playerKey in the body
// (a bearer secret does not belong in a URL, where server logs keep it).
// The two GETs are the email links — a mail client can only GET — and
// their tokens are single-purpose, unlike the key.
//
// The json() body parser is scoped to this router, never applied globally:
// global middleware in a composed process leaks onto every game and the
// menu, which is the exact bug the CORS-scoping work fixed.

import express, { type Request, type Response, Router } from 'express';
import { isPlayerKey, type NotifyService } from './service.js';
import type { PushSubscriptionRecord } from './records.js';

function body(req: Request): Record<string, unknown> {
  const value: unknown = req.body;
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function playerKeyOf(req: Request): string | null {
  const key = body(req).playerKey;
  return isPlayerKey(key) ? key : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseSubscription(value: unknown, addedAt: number): PushSubscriptionRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const sub = value as Record<string, unknown>;
  const keys = sub.keys;
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return null;
  if (typeof keys !== 'object' || keys === null) return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth }, addedAt };
}

/** Minimal page for the two email-link endpoints — no assets, no scripts. */
function page(res: Response, status: number, title: string, detail: string): void {
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
        `<title>${title}</title>` +
        `<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">` +
        `<h1 style="font-size:1.4rem">${title}</h1><p>${detail}</p></body>`,
    );
}

export function createNotifyRouter(service: NotifyService): Router {
  const router = Router();
  router.use(express.json({ limit: '16kb' }));

  router.get('/vapid-public-key', (_req, res) => {
    const key = service.pushPublicKey();
    if (key === null) res.status(404).json({ error: 'push not configured' });
    else res.json({ key });
  });

  router.post('/bind', (req, res) => {
    const playerKey = playerKeyOf(req);
    const b = body(req);
    const game = asString(b.game);
    const roomId = asString(b.roomId);
    const playerId = asString(b.playerId);
    const token = asString(b.token);
    if (!playerKey || !game || !roomId || !playerId || !token) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const bound = service.bindSeat(playerKey, game, roomId, playerId, token);
    if (!bound.ok) {
      res.status(bound.reason === 'seatRefused' ? 403 : 404).json({ error: bound.reason });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/settings', (req, res) => {
    const playerKey = playerKeyOf(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    res.json(service.settings(playerKey));
  });

  router.post('/subscriptions', (req, res) => {
    const playerKey = playerKeyOf(req);
    const subscription = parseSubscription(body(req).subscription, Date.now());
    if (!playerKey || !subscription) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service.addSubscription(playerKey, subscription);
    res.json({ ok: true });
  });

  router.post('/subscriptions/remove', (req, res) => {
    const playerKey = playerKeyOf(req);
    const endpoint = asString(body(req).endpoint);
    if (!playerKey || !endpoint) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service.removeSubscription(playerKey, endpoint);
    res.json({ ok: true });
  });

  router.post('/prefs', (req, res) => {
    const playerKey = playerKeyOf(req);
    const b = body(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service.setPrefs(playerKey, {
      push: typeof b.push === 'boolean' ? b.push : undefined,
      email: typeof b.email === 'boolean' ? b.email : undefined,
    });
    res.json({ ok: true });
  });

  router.post('/email', (req, res) => {
    const playerKey = playerKeyOf(req);
    const address = asString(body(req).email);
    if (!playerKey || address === null) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service
      .submitEmail(playerKey, address)
      .then((result) => {
        const status =
          result === 'emailUnavailable'
            ? 503
            : result === 'invalidAddress'
              ? 400
              : result === 'rateLimited'
                ? 429
                : 200;
        res.status(status).json({ result });
      })
      .catch(() => res.status(500).json({ error: 'internal' }));
  });

  router.post('/email/remove', (req, res) => {
    const playerKey = playerKeyOf(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service.removeEmail(playerKey);
    res.json({ ok: true });
  });

  router.get('/confirm', (req, res) => {
    const token = asString(req.query.token);
    const result = token === null ? 'invalid' : service.confirmEmail(token);
    if (result === 'confirmed') {
      page(
        res,
        200,
        'Email confirmed',
        'Turn notifications will now reach this address. You can close this tab.',
      );
    } else if (result === 'expired') {
      page(
        res,
        410,
        'Link expired',
        'Confirmation links last 24 hours. Open your notification settings in the game and send a fresh one.',
      );
    } else {
      page(res, 404, 'Link not recognised', 'This link is invalid or was already used.');
    }
  });

  router.get('/unsubscribe', (req, res) => {
    const token = asString(req.query.token);
    const ok = token === null ? false : service.unsubscribeEmail(token);
    if (ok) {
      page(
        res,
        200,
        'Unsubscribed',
        'Turn emails to this address are off. Re-enable them any time from your notification settings in the game.',
      );
    } else {
      page(res, 404, 'Link not recognised', 'This link is invalid.');
    }
  });

  return router;
}
