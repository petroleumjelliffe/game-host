import { useNavigate } from 'react-router-dom';

/** Minimal landing page: the title and two doors. Online-only game. */
export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl">
        <h1 className="mb-2 text-center text-3xl font-bold">Word Game</h1>
        <p className="mb-8 text-center text-gray-600">
          Build words on the board, from wherever you are
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => navigate('/online')}
            className="m-0 w-full rounded-lg bg-[var(--lobby-accent,#2563eb)] px-4 py-3 font-semibold text-[var(--lobby-on-accent,#ffffff)] hover:bg-[var(--lobby-accent-strong,#1d4ed8)]"
          >
            New room
          </button>
          <button
            type="button"
            onClick={() => navigate('/online/join')}
            className="m-0 w-full rounded-lg border border-gray-300 px-4 py-3 font-semibold hover:bg-gray-50"
          >
            Join room
          </button>
        </div>
      </div>
    </div>
  );
}
