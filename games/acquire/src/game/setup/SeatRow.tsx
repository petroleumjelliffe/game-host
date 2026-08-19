/**
 * One seat at the table: its avatar, its name, and a way to remove it.
 *
 * The avatar is shown, not chosen. There are exactly six avatars and at most
 * six seats, so assigning by index makes them distinct by construction and
 * leaves no collision logic to get wrong.
 */
export interface SeatRowProps {
  avatar: string;
  name: string;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function SeatRow({ avatar, name, onNameChange, onRemove, canRemove }: SeatRowProps) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <span className="flex-none text-2xl leading-none" aria-hidden="true">{avatar}</span>
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        aria-label={`Name for ${avatar}`}
        className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-sm font-semibold"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove ${name}`}
        className="m-0 flex-none rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
      >
        ✕
      </button>
    </li>
  );
}
