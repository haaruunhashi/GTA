/* Where the Google Maps Platform API key comes from.
 *
 * NEVER commit a real key. This file is safe to commit; it only *reads* a key.
 * Precedence:
 *   1. window.GOOGLE_MAPS_API_KEY  — set it in map-config.local.js (git-ignored)
 *   2. ?key=...                    — quick local testing only
 *
 * A browser key is always visible to anyone who opens the page, so the real
 * protection is on Google's side:
 *   - Google Cloud Console -> Credentials -> your key -> "Application restrictions"
 *     -> HTTP referrers -> add exactly your domain(s), e.g. https://yourgame.com/*
 *   - "API restrictions" -> restrict to the Map Tiles API only
 *   - set a billing budget + alerts; 3D tiles are billed per session
 * For a production build, inject it at build time (e.g. Vite `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`)
 * from a .env file that is git-ignored — never inline it in source.
 */
export function getApiKey() {
  if (typeof window !== 'undefined') {
    if (window.GOOGLE_MAPS_API_KEY) return window.GOOGLE_MAPS_API_KEY;
    const q = new URLSearchParams(location.search).get('key');
    if (q) return q;
  }
  return null;
}
