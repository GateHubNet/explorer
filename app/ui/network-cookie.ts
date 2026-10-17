// The `net` cookie remembers the last network a visitor used, for the redirect at `/` (the only reader). It is written in
// the browser, never with a Set-Cookie header: the edge cache does not store an answer that sets a cookie, and pages
// must be stored.

import type { NetworkId } from "../server/networks";

export const NETWORK_COOKIE = "net";

/** The value to assign to `document.cookie`: for a year, for the whole site, not sent along with other sites' requests. */
export function networkCookie(id: NetworkId): string {
  return `${NETWORK_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * An inline script that writes the cookie as the page loads, before React has hydrated (and without it, if it never does).
 * A client-side switch of network does not run it again; the layout's effect covers that.
 */
export function networkCookieScript(id: NetworkId): string {
  // `<` cannot end the script element from inside a string literal.
  return `document.cookie=${JSON.stringify(networkCookie(id)).replace(/</g, "\\u003c")}`;
}
