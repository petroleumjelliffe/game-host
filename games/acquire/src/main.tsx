import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { registerServiceWorker } from "./pwa/register";
import "./styles/index.css";

registerServiceWorker();

// The router's basename comes from Vite's own BASE_URL, which the config
// builds from the one copy of the path in `basePath.ts` — this file used to
// hold a second hardcoded copy. BASE_URL carries a trailing slash
// ('/acquire-startups-m1/'); the router wants none.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

// StrictMode double-invokes mount effects and state updaters on purpose, to
// surface ones that aren't idempotent. It is on here deliberately, and not
// merely as hygiene: the lobby's socket layer is about to be extracted and
// consumed by Rail Baron, which runs under StrictMode. Double connect,
// double join, and a rejoin racing its own token are the failures it is here
// to catch, and they are invisible without it.
//
// registerServiceWorker() stays outside the tree, above: it is not a React
// concern and must not be double-invoked.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
