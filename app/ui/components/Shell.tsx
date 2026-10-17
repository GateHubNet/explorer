import type { ReactNode } from "react";

import type { NetworkBrief } from "../networks";
import { Footer } from "./Footer";
import { Header } from "./Header";

/**
 * The frame of every page: the skip link, the header, `<main id="main">`, the footer. The wrapper carries the network
 * (`data-net`), which is what gives everything inside it the network's accent (tokens.css). `search={false}` leaves the
 * header's search box out, for a page that has a bigger one of its own (the home page).
 */
export function Shell({ net, search = true, children }: { net: NetworkBrief; search?: boolean; children: ReactNode }) {
  return (
    <div className="shell" data-net={net.id}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header net={net} search={search} />
      <main id="main" className="container main" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  );
}
