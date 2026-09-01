import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationSettings } from './NotificationSettings';
import type { NotifySettings } from './api';

const settings = (overrides: Partial<NotifySettings> = {}): NotifySettings => ({
  pushEnabled: true,
  emailEnabled: true,
  vapidPublicKey: 'a-key',
  prefs: { push: true, email: true },
  pushEndpoints: [],
  email: null,
  ...overrides,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('NotificationSettings', () => {
  it('says notifications are unavailable when the settings call 404s (standalone dev)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not found' }));
    render(<NotificationSettings onClose={() => {}} />);
    expect(
      await screen.findByText('Notifications are unavailable on this server.'),
    ).toBeInTheDocument();
  });

  it('says notifications are unavailable when the network fails outright', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    render(<NotificationSettings onClose={() => {}} />);
    expect(
      await screen.findByText('Notifications are unavailable on this server.'),
    ).toBeInTheDocument();
  });

  it('sends the settings request keyed on the stored playerKey', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, settings()));
    render(<NotificationSettings onClose={() => {}} />);
    await screen.findByText('Push');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/notify/settings');
    const body = JSON.parse((init as RequestInit).body as string) as { playerKey: string };
    expect(body.playerKey).toBe(localStorage.getItem('notify.key'));
    expect(body.playerKey.length).toBeGreaterThanOrEqual(16);
  });

  it('explains that this browser cannot push (no service worker in jsdom)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, settings()));
    render(<NotificationSettings onClose={() => {}} />);
    expect(
      await screen.findByText('This browser does not support push notifications.'),
    ).toBeInTheDocument();
  });

  it('submitting an email shows the check-your-inbox pending text', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, settings()))
      .mockResolvedValueOnce(jsonResponse(200, { result: 'confirmationSent' }));
    render(<NotificationSettings onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'pete@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Check your inbox — the confirmation link lasts 24 hours.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/notify/email', expect.anything());
    });
  });

  it('a 429 shows the rate-limit text', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, settings()))
      .mockResolvedValueOnce(jsonResponse(429, { result: 'rateLimited' }));
    render(<NotificationSettings onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'pete@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Too many attempts for now — try again later.'),
    ).toBeInTheDocument();
  });

  it('a 503 says email is not available on this server', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, settings()))
      .mockResolvedValueOnce(jsonResponse(503, { result: 'emailUnavailable' }));
    render(<NotificationSettings onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'pete@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Email isn’t available on this server.'),
    ).toBeInTheDocument();
  });

  it('shows a confirmed address from settings', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, settings({ email: { address: 'pete@example.com', status: 'confirmed' } })),
    );
    render(<NotificationSettings onClose={() => {}} />);
    expect(
      await screen.findByText('Turn emails go to pete@example.com.'),
    ).toBeInTheDocument();
  });

  it('shows a saved address read-only with an Edit affordance that seeds the input', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, settings({ email: { address: 'pete@example.com', status: 'confirmed' } })),
    );
    render(<NotificationSettings onClose={() => {}} />);
    expect(await screen.findByText('pete@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox')).toHaveValue('pete@example.com');
  });

  it('rejects a malformed address client-side, without calling the API', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, settings()));
    render(<NotificationSettings onClose={() => {}} />);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    // Only the initial settings fetch happened — the malformed address never
    // reached /notify/email.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the confirmed banner when email is confirmed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, settings({ email: { address: 'pete@example.com', status: 'confirmed' } })),
    );
    render(<NotificationSettings onClose={() => {}} />);
    expect(
      await screen.findByText(/the 🔔 badge now shows on your profile/),
    ).toBeInTheDocument();
  });
});
