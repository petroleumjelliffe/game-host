// The single copy of the base path. vite.config, the socket path, the static
// mount, the health route and the manifest all derive from it — the path a
// client is built under must equal the path the proxy forwards, because
// assets are requested at `<base>/assets/…` and nothing rewrites them.
export const BASE_PATH = '/wordgame';
