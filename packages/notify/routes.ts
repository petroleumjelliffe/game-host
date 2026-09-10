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
import { describeDevice } from './channels.js';
import type { PushSubscriptionRecord } from './records.js';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

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

function parseSubscription(
  value: unknown,
  addedAt: number,
  gameId: string | null,
): PushSubscriptionRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const sub = value as Record<string, unknown>;
  const keys = sub.keys;
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return null;
  if (typeof keys !== 'object' || keys === null) return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  return {
    endpoint: sub.endpoint,
    keys: { p256dh, auth },
    addedAt,
    // The scope tag. Optional and additive: a client built before it
    // existed sends none and mints an untagged (any-scope) record, exactly
    // what its subscriptions already were.
    ...(gameId === null ? {} : { gameId }),
  };
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
    // Both optional and both additive: clients built before they existed
    // send neither, and bind exactly as they always did (phase 'playing').
    const name = asString(b.name) ?? undefined;
    const phase = b.phase === 'lobby' || b.phase === 'playing' ? b.phase : undefined;
    const bound = service.bindSeat(playerKey, game, roomId, playerId, token, {
      ...(name === undefined ? {} : { name }),
      ...(phase === undefined ? {} : { phase }),
    });
    if (!bound.ok) {
      res.status(bound.reason === 'seatRefused' ? 403 : 404).json({ error: bound.reason });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/contacts', (req, res) => {
    const playerKey = playerKeyOf(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const b = body(req);
    const game = asString(b.game);
    const roomId = asString(b.roomId);
    const roomCtx = game !== null && roomId !== null ? { gameId: game, roomId } : undefined;
    res.json({ contacts: service.contacts(playerKey, roomCtx) });
  });

  router.post('/invite', (req, res) => {
    const playerKey = playerKeyOf(req);
    const b = body(req);
    const game = asString(b.game);
    const roomId = asString(b.roomId);
    const playerId = asString(b.playerId);
    const token = asString(b.token);
    const email = asString(b.email);
    const contactId = asString(b.contactId);
    // Exactly one target shape, never both, never neither.
    if (!playerKey || !game || !roomId || !playerId || !token || (email === null) === (contactId === null)) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service
      .invite({
        playerKey,
        gameId: game,
        roomId,
        playerId,
        token,
        ...(email === null ? {} : { email }),
        ...(contactId === null ? {} : { contactId }),
      })
      .then((result) => {
        if (result.ok) {
          res.json(result);
          return;
        }
        const status =
          result.reason === 'seatRefused'
            ? 403
            : result.reason === 'noSuchGame'
              ? 404
              : result.reason === 'rateLimited'
                ? 429
                : result.reason === 'emailUnavailable'
                  ? 503
                  : result.reason === 'invalidAddress' || result.reason === 'noSuchContact'
                    ? 400
                    : 409; // unreachable, alreadySeated, blocked, roomFull
        res.status(status).json(result);
      })
      .catch(() => res.status(500).json({ error: 'internal' }));
  });

  router.post('/invite/remind', (req, res) => {
    const playerKey = playerKeyOf(req);
    const b = body(req);
    const game = asString(b.game);
    const roomId = asString(b.roomId);
    const playerId = asString(b.playerId);
    const token = asString(b.token);
    const targetPlayerId = asString(b.targetPlayerId);
    if (!playerKey || !game || !roomId || !playerId || !token || !targetPlayerId) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service
      .remind({ playerKey, gameId: game, roomId, playerId, token, targetPlayerId })
      .then((result) => {
        if (result.ok) res.json(result);
        else {
          const status =
            result.reason === 'seatRefused'
              ? 403
              : result.reason === 'rateLimited'
                ? 429
                : result.reason === 'noSuchGame'
                  ? 404
                  : 409;
          res.status(status).json(result);
        }
      })
      .catch(() => res.status(500).json({ error: 'internal' }));
  });

  // The two send-me-a-link endpoints. No playerKey — a visitor who holds
  // nothing yet is exactly who they are for — and one vague answer for
  // every case (the mail goes only to the address already on the seat or
  // invite, so the visitor learns nothing they could not learn by asking
  // the table). 429 is the only other shape: an attempt cap, counted
  // whether or not anything exists.
  router.post('/seat-signin', (req, res) => {
    const b = body(req);
    const game = asString(b.game);
    const roomId = asString(b.roomId);
    const playerId = asString(b.playerId);
    if (!game || !roomId || !playerId) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const result = service.seatSignin(game, roomId, playerId);
    if (result === 'cooldown') res.status(429).json({ ok: false, reason: 'rateLimited' });
    else res.json({ ok: true });
  });

  router.post('/invite/refresh', (req, res) => {
    const inviteToken = asString(body(req).inviteToken);
    if (!inviteToken) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const result = service.refreshInvite(inviteToken);
    if (result === 'cooldown') res.status(429).json({ ok: false, reason: 'rateLimited' });
    else res.json({ ok: true });
  });

  // Claim and key redemption answer one shape for every failure — an
  // invalid, revoked, spent, or fabricated credential is indistinguishable
  // from a room that never existed (the non-probe rule).
  router.post('/invite/claim', (req, res) => {
    const b = body(req);
    const inviteToken = asString(b.inviteToken);
    const playerKey = playerKeyOf(req) ?? undefined;
    if (inviteToken === null) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const creds = service.claimInvite(inviteToken, playerKey);
    if (creds === null) res.status(404).json({ error: 'unavailable' });
    else res.json(creds);
  });

  router.post('/redeem-key', (req, res) => {
    const key = asString(body(req).key);
    if (key === null) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const creds = service.redeemSeatKey(key);
    if (creds === null) res.status(404).json({ error: 'unavailable' });
    else res.json(creds);
  });

  // Restore (spec 2026-09-09 §Restore). The answer carries every live seat
  // token the person holds: nothing here logs, and nothing else may.
  router.post('/me', (req, res) => {
    const playerKey = playerKeyOf(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    res.json(service.me(playerKey));
  });

  // The in-app accept: claim by the hash the server holds, same single
  // refusal shape as the emailed claim.
  router.post('/invite/accept', (req, res) => {
    const playerKey = playerKeyOf(req);
    const b = body(req);
    const game = asString(b.game);
    const roomId = asString(b.roomId);
    if (!playerKey || game === null || roomId === null) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    const creds = service.acceptInvite(playerKey, game, roomId);
    if (creds === null) res.status(404).json({ error: 'unavailable' });
    else res.json(creds);
  });

  router.post('/signout', (req, res) => {
    const playerKey = playerKeyOf(req);
    if (!playerKey) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service.signOut(playerKey);
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
    const subscription = parseSubscription(
      body(req).subscription,
      Date.now(),
      asString(body(req).game),
    );
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
    const b = body(req);
    const address = asString(b.email);
    // What asked, for the mail: the installed app or a browser tab. Optional
    // (older clients send none); anything else is a malformed request.
    const device = b.device;
    if (
      !playerKey ||
      address === null ||
      (device !== undefined && device !== 'app' && device !== 'browser')
    ) {
      res.status(400).json({ error: 'bad request' });
      return;
    }
    service
      .submitEmail(playerKey, address, device)
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

  // Confirming signs a device in (spec 2026-09-09 §Confirming now signs in a
  // device), so the emailed link only SHOWS; a button POSTs. A mail scanner
  // that prefetches links can no longer confirm on the person's behalf.
  router.get('/confirm', (req, res) => {
    const token = asString(req.query.token);
    const details = token === null ? 'invalid' : service.confirmationDetails(token);
    if (details === 'expired') {
      page(res, 410, 'Link expired', 'Sign-in links last 24 hours. Ask for a fresh one from the game.');
      return;
    }
    if (details === 'invalid') {
      page(res, 404, 'Link not recognised', 'This link is invalid or was already used.');
      return;
    }
    const what = escapeHtml(describeDevice(details.device));
    const when = escapeHtml(new Date(details.requestedAt).toUTCString());
    // `page` wraps this in a paragraph; the form closes and reopens it.
    page(
      res,
      200,
      'Sign in this device?',
      `${what} asked to sign in as <strong>${escapeHtml(details.address)}</strong> at ${when}. ` +
        `Confirming signs that device in: it will see every game this address is seated in, ` +
        `and turn emails will come here.</p>` +
        `<form method="post" action="/notify/confirm">` +
        `<input type="hidden" name="token" value="${escapeHtml(token ?? '')}">` +
        `<button type="submit" style="font:inherit;padding:.6rem 1.2rem">Sign in this device</button>` +
        `</form><p>Not you? Close this page and nothing happens.`,
    );
  });

  router.post('/confirm', express.urlencoded({ extended: false }), (req, res) => {
    const token = asString(body(req).token);
    const details = token === null ? 'invalid' : service.confirmationDetails(token);
    const result = token === null ? 'invalid' : service.confirmEmail(token);
    if (result === 'confirmed') {
      const back =
        typeof details === 'object' && details.device === 'app'
          ? 'Go back to the app — your games are there now.'
          : 'Go back to the game — your games are there now.';
      page(res, 200, 'Signed in', back);
    } else if (result === 'expired') {
      page(res, 410, 'Link expired', 'Sign-in links last 24 hours. Ask for a fresh one from the game.');
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
