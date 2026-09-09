/**
 * Whether this page is running as the installed app rather than in a browser
 * tab.
 *
 * `display-mode: standalone` is the manifest's display mode reflected back by
 * the browser; iOS Safari predates that media feature and exposes
 * `navigator.standalone` instead, so both are consulted. Guarded, because
 * jsdom has neither.
 *
 * What hangs off it: the "Update ready" reminder. In a tab it is noise — a
 * plain refresh picks the new build up through the network-first worker — but
 * the installed app has no refresh gesture, so the reminder is the only
 * civilised way in (owner, from the first real install).
 */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneDisplay =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneDisplay || iosStandalone;
}
