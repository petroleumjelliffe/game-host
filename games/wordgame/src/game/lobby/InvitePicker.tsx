// src/game/lobby/InvitePicker.tsx
// The invite picker: a bottom sheet over the dimmed lobby (the room stays
// visible behind it — the design's ruling), one control with two ways in:
// past co-players by name, and an email field. This game's skin over the
// shared notify-client hooks; the states are the checklist's P2.

import { useState } from 'react';
import { useContacts } from '@game-host/notify/client/useContacts';
import { sendInvite, type ContactRow } from '@game-host/notify/client/invites';

export interface InvitePickerProps {
  roomId: string;
  /** The inviter's own seat — proof, via the server's verifySeat, of being in the room. */
  self: { playerId: string; token: string };
  onClose(): void;
}

type Tab = 'contacts' | 'email';
type RowNote = 'sending' | 'sent' | string; // string = the server's refusal
type EmailNote = 'invalid' | 'sending' | 'sent' | string | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function refusalText(reason: string): string {
  switch (reason) {
    case 'rateLimited': return 'Daily invite limit reached — try again tomorrow.';
    case 'roomFull': return 'The room filled up while the picker was open.';
    case 'alreadySeated': return 'Already in this room.';
    case 'emailUnavailable': return 'Email isn’t set up on this server.';
    default: return 'Could not send — try again.';
  }
}

function agoText(lastPlayedAt: number): string {
  const days = Math.floor((Date.now() - lastPlayedAt) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return 'last week';
  return 'a while back';
}

export function InvitePicker({ roomId, self, onClose }: InvitePickerProps) {
  const [tab, setTab] = useState<Tab>('contacts');
  const contacts = useContacts({ game: 'wordgame', roomId }, true);
  const [rowNotes, setRowNotes] = useState<Record<string, RowNote>>({});
  const [draft, setDraft] = useState('');
  const [emailNote, setEmailNote] = useState<EmailNote>(null);

  const inviteContact = (contact: ContactRow) => {
    setRowNotes((notes) => ({ ...notes, [contact.contactId]: 'sending' }));
    void sendInvite({
      game: 'wordgame',
      roomId,
      playerId: self.playerId,
      token: self.token,
      contactId: contact.contactId,
    }).then((outcome) => {
      setRowNotes((notes) => ({
        ...notes,
        [contact.contactId]: outcome.ok ? 'sent' : outcome.reason,
      }));
    });
  };

  const inviteEmail = () => {
    const address = draft.trim();
    if (!EMAIL_RE.test(address)) {
      setEmailNote('invalid');
      return;
    }
    setEmailNote('sending');
    void sendInvite({
      game: 'wordgame',
      roomId,
      playerId: self.playerId,
      token: self.token,
      email: address,
    }).then((outcome) => {
      if (outcome.ok) {
        setEmailNote('sent');
        setDraft('');
      } else {
        setEmailNote(outcome.reason);
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(43,40,32,0.28)]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Invite to room ${roomId}`}
        className="w-full max-w-[398px] rounded-t-[22px] bg-paper px-4 pb-5 pt-3.5 shadow-[0_-8px_32px_rgba(31,41,26,0.25)]"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div aria-hidden className="mx-auto mb-2.5 h-1 w-9 rounded-sm bg-line-strong" />
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="flex-1 text-[16px] font-bold text-ink">Invite to room {roomId}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close invite picker"
            className="rounded px-1 text-lg text-ink-ghost"
          >
            ✕
          </button>
        </div>

        <div className="mb-2.5 flex gap-[3px] rounded-[10px] bg-[#e9e4d6] p-[3px]">
          {(['contacts', 'email'] as const).map((which) => (
            <button
              key={which}
              type="button"
              onClick={() => { setTab(which); }}
              className={`m-0 flex-1 rounded-lg px-2 py-1.5 text-[13px] ${
                tab === which
                  ? 'bg-white font-bold text-ink shadow-sm'
                  : 'font-semibold text-ink-faint'
              }`}
            >
              {which === 'contacts' ? 'People you’ve played with' : 'By email'}
            </button>
          ))}
        </div>

        {tab === 'contacts' ? (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {contacts.status === 'loading' && (
              <li className="py-3 text-center text-sm text-ink-mute">Loading…</li>
            )}
            {contacts.status === 'ready' && contacts.contacts.length === 0 && (
              // Also the no-profile state: a player whose storage is blocked
              // reads the same as one who hasn't played yet (checklist P2).
              <li className="py-3 text-center text-sm text-ink-mute">
                Nobody yet — play a game first.
              </li>
            )}
            {contacts.contacts.map((contact) => {
              const rowNote = rowNotes[contact.contactId];
              const seated = contact.alreadySeated === true || rowNote === 'alreadySeated';
              const pickable = contact.reachable && !seated;
              return (
                <li
                  key={contact.contactId}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                    pickable ? 'border-line bg-white' : 'border-[#eae4d6] bg-[#faf8f2]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className={`text-[14px] font-semibold ${pickable ? 'text-ink' : 'text-ink-ghost'}`}>
                      {contact.name}
                    </div>
                    <div className="text-[12px] text-ink-ghost">
                      {seated
                        ? 'Already in this room'
                        : !contact.reachable
                          // Visible but unpickable, with a reason a person can
                          // act on — a hidden row reads as a broken list.
                          ? `${contact.name} hasn’t turned on notifications`
                          : `${contact.gameTitle} · ${agoText(contact.lastPlayedAt)}`}
                    </div>
                    {rowNote !== undefined && rowNote !== 'sending' && rowNote !== 'sent' && (
                      <div className="text-[12px] text-danger-ink">{refusalText(rowNote)}</div>
                    )}
                  </div>
                  {pickable && (
                    <button
                      type="button"
                      disabled={rowNote === 'sending' || rowNote === 'sent'}
                      onClick={() => { inviteContact(contact); }}
                      className={`m-0 flex-none rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${
                        rowNote === 'sending' || rowNote === 'sent'
                          ? 'bg-[var(--lobby-accent,#2563eb)] text-white opacity-90'
                          : 'border-[1.5px] border-[var(--lobby-accent,#2563eb)] text-[var(--lobby-accent,#2563eb)]'
                      }`}
                    >
                      {rowNote === 'sending' ? 'Sending…' : rowNote === 'sent' ? '✓ Invited' : 'Invite'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex flex-col gap-2">
            <form
              noValidate
              className="flex gap-2"
              onSubmit={(e) => { e.preventDefault(); inviteEmail(); }}
            >
              <input
                type="email"
                aria-label="Email address to invite"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setEmailNote(null); }}
                placeholder="friend@example.com"
                className={`min-w-0 flex-1 rounded-lg border-[1.5px] bg-white px-2.5 py-2 text-sm text-ink outline-none ${
                  emailNote === 'invalid' ? 'border-danger-ink' : 'border-line-strong'
                }`}
              />
              <button
                type="submit"
                disabled={emailNote === 'sending' || draft.trim() === ''}
                className="m-0 rounded-lg bg-[var(--lobby-accent,#2563eb)] px-3.5 py-2 text-sm font-semibold text-white disabled:bg-line disabled:text-ink-faint"
              >
                {emailNote === 'sending' ? 'Sending…' : 'Invite'}
              </button>
            </form>
            {emailNote !== null && emailNote !== 'sending' && (
              <p className={`text-[12.5px] ${emailNote === 'sent' ? 'text-[#3f7a4d]' : 'text-danger-ink'}`}>
                {emailNote === 'sent'
                  ? 'Invite sent — their seat is saved until they claim it.'
                  : emailNote === 'invalid'
                    ? 'That doesn’t look like an email address.'
                    : refusalText(emailNote)}
              </p>
            )}
            <p className="text-[11.5px] text-ink-ghost">
              They get one email with a link that claims their seat. Nothing
              more is sent unless they take it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
