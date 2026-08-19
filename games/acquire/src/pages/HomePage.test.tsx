import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';

/** jsdom lets navigator.onLine be redefined; the events drive the hook. */
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

afterEach(() => setOnline(true));

describe('the mode chooser and the network', () => {
  it('offers both modes when online', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /online/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /pass & play/i })).toBeEnabled();
  });

  /**
   * The offline design's one sentence of honesty (spec, 2026-08-08): an
   * installed app with no network must not offer Online as though it will
   * work. The wording is the device-offline vocabulary the prod pass
   * observed — one phrasing across the app, not a second one invented here.
   */
  it('disables Online with the established wording when the network goes', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    setOnline(false);

    expect(screen.getByRole('button', { name: /online/i })).toBeDisabled();
    expect(screen.getByText(/no network — waiting for this device to reconnect/i)).toBeInTheDocument();
    // Pass & Play is untouched: it is the mode that genuinely works offline.
    expect(screen.getByRole('button', { name: /pass & play/i })).toBeEnabled();
  });

  it('re-offers Online the moment the network returns', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);

    setOnline(false);
    setOnline(true);

    expect(screen.getByRole('button', { name: /online/i })).toBeEnabled();
    expect(screen.queryByText(/no network/i)).toBeNull();
  });
});

describe('no URL renders a white screen', () => {
  /**
   * The failure this pins: the owner installed the app on a phone from the
   * dev server; the manifest's start_url is the prod base path; the dev
   * router had no route there and React rendered *nothing*. A blank page is
   * never an acceptable answer to a URL — unknown paths go home.
   */
  it('redirects an unknown path to the mode chooser', async () => {
    const { default: App } = await import('../App');
    render(
      <MemoryRouter initialEntries={['/acquire-startups-m1/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/choose your game mode/i)).toBeInTheDocument();
  });
});
