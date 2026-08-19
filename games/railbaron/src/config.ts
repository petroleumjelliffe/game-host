/**
 * The server this client speaks to.
 *
 * `VITE_SERVER_URL` (a deployed build) wins outright, and sockets keep
 * socket.io's default path — that server owns its whole origin. Otherwise
 * everything is relative to the page's origin: Vite's proxy (dev) or the
 * game server itself (hosted, `npm run serve`) answers under BASE_PATH. No
 * host or port lives in client code — the port registry (game-host
 * PORTS.md) is the machine's business now. A phone on the LAN works for
 * free: its origin is whatever page it loaded.
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? window.location.origin;

/** socket.io mount path; undefined lets a VITE_SERVER_URL server default. */
export const SOCKET_PATH: string | undefined =
  import.meta.env.VITE_SERVER_URL ? undefined : `${import.meta.env.BASE_URL}socket.io`;
