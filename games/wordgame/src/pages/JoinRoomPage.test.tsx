import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { JoinRoomPage } from './JoinRoomPage';

function RoomMarker() {
  const { roomId } = useParams();
  return <div>room:{roomId}</div>;
}

function renderJoin(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/online/join" element={<JoinRoomPage />} />
        <Route path="/room/:roomId" element={<RoomMarker />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JoinRoomPage', () => {
  it('prefills the code from the query string', () => {
    renderJoin('/online/join?code=ktwq');
    expect(screen.getByLabelText('Room code')).toHaveValue('KTWQ');
  });

  it('leaves the code blank when the query string has none', () => {
    renderJoin('/online/join');
    expect(screen.getByLabelText('Room code')).toHaveValue('');
  });

  // The page never joins. A started room refuses a fresh join with "that
  // seat is no longer yours", which is what an installed app with no
  // stored seat used to see (2026-09-09). The room page's chooser owns
  // both "Sit here" and "That's me"; this page only gets you there.
  it('submitting a code navigates to the room rather than joining', () => {
    renderJoin('/online/join');
    fireEvent.change(screen.getByLabelText('Room code'), { target: { value: 'abc123' } });
    fireEvent.submit(screen.getByLabelText('Room code').closest('form')!);
    expect(screen.getByText('room:ABC123')).toBeInTheDocument();
  });

  it('has no name field — the lobby asks after you sit', () => {
    renderJoin('/online/join');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
  });
});
