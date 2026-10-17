import { useEffect } from "react";

import type { NetworkId } from "../../server/networks";
import { networkCookie, networkCookieScript } from "../network-cookie";

/**
 * Remembers `net` as the visitor's last network, for the redirect at `/`. Written in the browser, never with Set-Cookie
 * (see network-cookie.ts): by an inline script as the page loads, and by an effect, which also covers a switch of network
 * made by a client-side navigation, where the page's scripts are not run again.
 */
export function NetworkCookie({ net }: { net: NetworkId }) {
  useEffect(() => {
    document.cookie = networkCookie(net);
  }, [net]);
  return <script dangerouslySetInnerHTML={{ __html: networkCookieScript(net) }} />;
}
