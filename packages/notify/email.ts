// packages/notify/email.ts
// The real email channel: Nodemailer over SMTP, provider chosen entirely by
// env — SMTP_URL is a standard smtp(s):// URL, so Resend, Mailgun, SES or a
// home relay are all the same one variable. Nothing here names a provider.
//
// Imported dynamically and only when configured, same as webPush.ts. The
// service also requires NOTIFY_ORIGIN before it will use this channel: every
// email carries absolute links (confirm, the room, unsubscribe), and a mail
// client has no origin to be relative to.

import type { EmailSender, TurnPayload } from './channels.js';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function emailSenderFromEnv(
  env: Record<string, string | undefined>,
  log: (line: string) => void,
): Promise<EmailSender | null> {
  const smtpUrl = env.SMTP_URL?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!smtpUrl || !from) {
    log('· Email notifications off (no SMTP_URL / EMAIL_FROM)');
    return null;
  }
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport(smtpUrl);

  return {
    async sendConfirmation(to: string, confirmUrl: string): Promise<void> {
      await transport.sendMail({
        from,
        to,
        subject: 'Confirm turn notifications',
        text:
          `Someone (hopefully you) asked for it's-your-turn emails at this address.\n\n` +
          `Confirm within 24 hours:\n${confirmUrl}\n\n` +
          `If this wasn't you, ignore this email and nothing further will be sent.`,
        html:
          `<p>Someone (hopefully you) asked for it's-your-turn emails at this address.</p>` +
          `<p><a href="${escapeHtml(confirmUrl)}">Confirm email notifications</a> (link lasts 24 hours).</p>` +
          `<p>If this wasn't you, ignore this email and nothing further will be sent.</p>`,
      });
    },

    async sendTurn(
      to: string,
      payload: TurnPayload,
      roomUrl: string,
      unsubscribeUrl: string,
    ): Promise<void> {
      const title = `${payload.gameTitle} — it's your turn`;
      await transport.sendMail({
        from,
        to,
        subject: `${title} (room ${payload.roomId})`,
        text:
          `It's your turn in ${payload.gameTitle}, room ${payload.roomId}.\n\n` +
          `Take it: ${roomUrl}\n\n` +
          `Stop these emails: ${unsubscribeUrl}`,
        html:
          `<p>It's your turn in <strong>${escapeHtml(payload.gameTitle)}</strong>, room ${escapeHtml(payload.roomId)}.</p>` +
          `<p><a href="${escapeHtml(roomUrl)}">Take your turn</a></p>` +
          `<p style="color:#666;font-size:0.85em"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a> from turn emails.</p>`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      });
    },
  };
}
