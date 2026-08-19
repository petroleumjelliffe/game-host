// src/pages/HomePage.tsx
// Landing page for mode selection

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnline } from '../pwa/useOnline';
import { useUpdateReady } from '../pwa/update';
import { isInstalledApp } from '../pwa/installed';

export function HomePage() {
  const navigate = useNavigate();
  // An installed app can genuinely be offline, and the honest split is the
  // whole PWA design: Pass & Play works with no network, Online cannot — the
  // server is the authority and there is deliberately no local fallback. So
  // Online is not offered as though it would work, with the same wording the
  // device-offline pill already uses. One vocabulary, not two.
  const online = useOnline();
  // A new build, installed and waiting. Surfaced here and only here: the mode
  // chooser is the one screen where nobody is mid-game, so restarting costs
  // nothing. The ruling is next-launch activation — this button is the
  // explicit exception, never an automatic one.
  const update = useUpdateReady();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-xl w-[600px] max-w-full">
        <h1 className="text-3xl font-bold mb-2 text-center">Acquire</h1>
        <p className="text-center text-gray-600 mb-8">Choose your game mode</p>

        <div className="space-y-4">
          {/* Online Multiplayer */}
          <button
            onClick={() => navigate('/online')}
            disabled={!online}
            className="w-full px-6 py-5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-left group disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">🌐</span>
              <div className="flex-1">
                <div className="font-bold text-xl mb-1">Online</div>
                <div className={`text-sm ${online ? 'text-blue-100' : 'text-gray-100'}`}>
                  {online
                    ? 'Each player joins from their own device. Share a room link to play together remotely.'
                    : 'No network — waiting for this device to reconnect.'}
                </div>
              </div>
            </div>
          </button>

          {/* Pass & Play */}
          <button
            onClick={() => navigate('/pass-and-play')}
            className="w-full px-6 py-5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-left group"
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">🎮</span>
              <div className="flex-1">
                <div className="font-bold text-xl mb-1">Pass & Play</div>
                <div className="text-green-100 text-sm">
                  Everyone plays on this device. Pass it around after each turn (local hotseat).
                </div>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-8 text-center text-xs text-gray-400">
          Both modes support 2–6 players
        </div>

        {/* Installed app only. In a tab this is noise — a refresh gets the
            new build through the network-first worker — but the installed app
            has no refresh gesture, so this is its one way in. (Owner, from
            the first real install.) */}
        {isInstalledApp() && update.ready && (
          <button
            type="button"
            onClick={update.apply}
            className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Update ready — restart the app
          </button>
        )}
      </div>
    </div>
  );
}
