import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { nameViewOf, type NameMap } from "../../domain/names";
import { shortAddress } from "../../domain/format";
import { NamesProvider } from "../names";
import { AccountLink } from "./AccountLink";

afterEach(cleanup);

// The link to an account, with the names of the page's addresses (E9, spec 4.1): a name and its marks, the address with the labels' mark, or
// today's link. Fictional names and `*.example` domains, the views of the names helper's own tests.
const A = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const B = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const C = "rrrrrrrrrrrrrrrrrrrrBZbvji";
const D = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";
const E = "rBg5JN5ShW8ZRV1TJhxVJRYcXVbPGC3ARi";
const F = "rJF2XaN4q9D9E2hzK5qJ6kAn7rR7yGfQvg";
const G = "rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRh";

const NAMES: NameMap = {
  [A]: nameViewOf({ address: A, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" })!,
  [B]: nameViewOf({
    address: B,
    display_name: { text: "Harborline Exchange", kind: "account" },
    account_name: "Harborline Exchange",
    account_network_name: "hot wallet",
    labels: { advisory: { description: "Withdrawals paused" } },
  })!,
  [D]: nameViewOf({ address: D, display_name: { text: "lowtide.example", kind: "domain" }, domain: "lowtide.example" })!,
  [E]: nameViewOf({ address: E, labels: { scam: { description: "d" }, spam: { description: "d" } } })!,
  // An account network name and nothing else: nothing to draw in a link, so the link is today's.
  [C]: nameViewOf({ address: C, account_network_name: "cold wallet" })!,
  // A name that says nothing would be a link with no words.
  [F]: { name: { text: "", kind: "verified" }, domain: "empty.example", labels: [] },
  // The same, labelled: the address, and the mark.
  [G]: { name: { text: "", kind: "account" }, labels: ["spam"] },
};

const routed = (ui: ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;
const named = (ui: ReactElement) => render(routed(<NamesProvider names={NAMES}>{ui}</NamesProvider>));

describe("a verified name", () => {
  it("is the link text, with the hidden words 'verified name' in the link's name, and the title says who verified it and the address", () => {
    named(<AccountLink net="xrpl" address={A} />);
    const link = screen.getByRole("link", { name: "Northpeak Treasury verified name" });
    expect(link.getAttribute("href")).toBe(`/xrpl/account/${A}`);
    expect(link.getAttribute("title")).toBe(`Verified by northpeak.example · ${A}`);
    expect(link.querySelector(".acct__name")!.textContent).toBe("Northpeak Treasury");
    expect(link.querySelector(".namemark--verified")).not.toBeNull();
  });

  it("is not mono, and not shortened: the address is not drawn without `full`", () => {
    named(<AccountLink net="xahau" address={A} />);
    const link = screen.getByRole("link");
    expect(link.classList.contains("acct")).toBe(true);
    expect(link.classList.contains("mono")).toBe(false);
    expect(link.classList.contains("ent")).toBe(false);
    expect(link.getAttribute("href")).toBe(`/xahau/account/${A}`);
    expect(link.querySelector(".acct__address")).toBeNull();
    expect(link.textContent).not.toContain("rHb9CJ");
  });

  it("draws its icon for the eye and not for assistive technology", () => {
    named(<AccountLink net="xrpl" address={A} />);
    const icons = screen.getByRole("link").querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0]!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("a name given by GateHub", () => {
  it("has the account network name after the name, the hidden words of both marks, and the labels in the title", () => {
    named(<AccountLink net="xrpl" address={B} />);
    const link = screen.getByRole("link", { name: "Harborline Exchange · hot wallet named by GateHub labelled advisory by GateHub" });
    expect(link.querySelector(".acct__name")!.textContent).toBe("Harborline Exchange · hot wallet");
    expect(link.getAttribute("title")).toBe(`Named by GateHub · ${B} · Labelled advisory by GateHub`);
    expect(link.querySelector(".namemark--account")).not.toBeNull();
    expect(link.querySelector(".labelmark")).not.toBeNull();
    expect(Array.from(link.querySelectorAll("svg"), (icon) => icon.getAttribute("aria-hidden"))).toEqual(["true", "true"]);
  });
});

describe("a name nothing vouches for", () => {
  it("is the domain as the text, with the visible tag 'not verified' after it", () => {
    named(<AccountLink net="xrpl" address={D} />);
    const link = screen.getByRole("link", { name: "lowtide.example not verified" });
    expect(link.querySelector(".acct__name")!.textContent).toBe("lowtide.example");
    expect(link.querySelector(".unv")!.textContent).toBe("not verified");
    expect(link.getAttribute("title")).toBe(`Domain not verified · ${D}`);
    expect(link.querySelectorAll("svg")).toHaveLength(0);
  });
});

describe("labels only", () => {
  it("is the short address as today, mono, with the LabelMark, and the label words in the title", () => {
    named(<AccountLink net="xrpl" address={E} />);
    const link = screen.getByRole("link", { name: `${shortAddress(E)} labelled scam and spam by GateHub` });
    expect(link.classList.contains("mono")).toBe(true);
    expect(link.classList.contains("acct")).toBe(false);
    expect(link.textContent).toBe(`${shortAddress(E)} labelled scam and spam by GateHub`);
    expect(link.querySelector(".labelmark")).not.toBeNull();
    expect(link.querySelector(".namemark")).toBeNull();
    expect(link.getAttribute("title")).toBe(`${E} · Labelled scam and spam by GateHub`);
  });

  it("with `full` is the whole address, and the words are in the title all the same", () => {
    named(<AccountLink net="xrpl" address={E} full />);
    const link = screen.getByRole("link", { name: `${E} labelled scam and spam by GateHub` });
    expect(link.classList.contains("mono")).toBe(true);
    expect(link.getAttribute("title")).toBe(`${E} · Labelled scam and spam by GateHub`);
  });

  it("keeps the chip", () => {
    named(<AccountLink net="xrpl" address={E} variant="chip" />);
    const link = screen.getByRole("link");
    expect(link.classList.contains("ent")).toBe(true);
    expect(link.classList.contains("mono")).toBe(true);
  });
});

describe("full", () => {
  it("follows the name with the whole address in .acct__address, which is mono, inside the link", () => {
    named(<AccountLink net="xrpl" address={A} full />);
    const link = screen.getByRole("link", { name: `Northpeak Treasury verified name ${A}` });
    const address = link.querySelector<HTMLElement>(".acct__address")!;
    expect(address.textContent).toBe(A);
    expect(address.classList.contains("mono")).toBe(true);
    expect(link.querySelector(".acct__name")!.textContent).toBe("Northpeak Treasury");
    expect(link.classList.contains("mono")).toBe(false);
    // The order: the name, its mark, the labels' mark when there is one, then the address.
    expect(Array.from(link.children, (child) => child.className.split(" ")[0])).toEqual(["acct__name", "namemark", "acct__address"]);
  });

  it("puts the labels' mark before the address", () => {
    named(<AccountLink net="xrpl" address={B} full />);
    const link = screen.getByRole("link");
    expect(Array.from(link.children, (child) => child.className.split(" ")[0])).toEqual(["acct__name", "namemark", "labelmark", "acct__address"]);
    expect(link.getAttribute("title")).toBe(`Named by GateHub · ${B} · Labelled advisory by GateHub`);
  });
});

describe("variant", () => {
  it("chip keeps ent beside acct for a name", () => {
    named(<AccountLink net="xrpl" address={A} variant="chip" />);
    const link = screen.getByRole("link");
    expect(link.classList.contains("acct")).toBe(true);
    expect(link.classList.contains("ent")).toBe(true);
    expect(link.classList.contains("mono")).toBe(false);
  });

  it("plain has no ent", () => {
    named(<AccountLink net="xrpl" address={A} variant="plain" />);
    expect(screen.getByRole("link").classList.contains("ent")).toBe(false);
  });
});

// Today's output, as the Worker prints it before there are names (captured before AccountLink was changed): a page without a provider, an address the
// provider does not know, and one whose view has nothing to draw, all print this.
const TODAY = {
  short: `<a class="mono" title="${A}" href="/xrpl/account/${A}" data-discover="true">rHb9CJ…tyTh</a>`,
  full: `<a class="mono" href="/xahau/account/${A}" data-discover="true">${A}</a>`,
  chip: `<a class="mono ent" title="${A}" href="/xrpl/account/${A}" data-discover="true">rHb9CJ…tyTh</a>`,
  fullChip: `<a class="mono ent" href="/xrpl/account/${A}" data-discover="true">${A}</a>`,
};

function todaysMarkup(address: string): string[] {
  return [
    renderToString(routed(<AccountLink net="xrpl" address={address} />)),
    renderToString(routed(<AccountLink net="xahau" address={address} full />)),
    renderToString(routed(<AccountLink net="xrpl" address={address} variant="chip" />)),
    renderToString(routed(<AccountLink net="xrpl" address={address} full variant="chip" />)),
  ];
}

describe("without a name", () => {
  it("outside a provider, is today's markup exactly: short, full, chip, full chip", () => {
    expect(todaysMarkup(A)).toEqual([TODAY.short, TODAY.full, TODAY.chip, TODAY.fullChip]);
  });

  it("in a provider that has no view of the address, is today's markup exactly", () => {
    const html = [
      <AccountLink key="a" net="xrpl" address={A} />,
      <AccountLink key="b" net="xahau" address={A} full />,
      <AccountLink key="c" net="xrpl" address={A} variant="chip" />,
      <AccountLink key="d" net="xrpl" address={A} full variant="chip" />,
    ].map((link) => renderToString(routed(<NamesProvider names={{ [B]: NAMES[B]! }}>{link}</NamesProvider>)));
    expect(html).toEqual([TODAY.short, TODAY.full, TODAY.chip, TODAY.fullChip]);
  });

  it("for a view that is an account network name alone, is today's markup exactly (there is no name and no label to draw)", () => {
    const today = (address: string) => todaysMarkup(address).map((html) => html.replaceAll(A, address).replace("rHb9CJ…tyTh", shortAddress(address)));
    const known = [
      renderToString(routed(<NamesProvider names={NAMES}><AccountLink net="xrpl" address={C} /></NamesProvider>)),
      renderToString(routed(<NamesProvider names={NAMES}><AccountLink net="xahau" address={C} full /></NamesProvider>)),
      renderToString(routed(<NamesProvider names={NAMES}><AccountLink net="xrpl" address={C} variant="chip" /></NamesProvider>)),
      renderToString(routed(<NamesProvider names={NAMES}><AccountLink net="xrpl" address={C} full variant="chip" /></NamesProvider>)),
    ];
    expect(known).toEqual(today(C));
  });

  it("for a name with no words, draws the address and not an empty link", () => {
    named(<AccountLink net="xrpl" address={F} />);
    const link = screen.getByRole("link");
    expect(link.textContent).toBe(shortAddress(F));
    expect(link.classList.contains("mono")).toBe(true);
    expect(link.querySelector(".namemark")).toBeNull();
  });

  it("for a name with no words and a label, draws the address with the label's mark", () => {
    named(<AccountLink net="xrpl" address={G} />);
    const link = screen.getByRole("link", { name: `${shortAddress(G)} labelled spam by GateHub` });
    expect(link.classList.contains("mono")).toBe(true);
    expect(link.querySelector(".labelmark")).not.toBeNull();
    expect(link.querySelector(".namemark")).toBeNull();
  });
});

describe("as the Worker prints it and the browser takes it over", () => {
  it.each([A, B, D, E, F])("%s: the same on the first client render, without a mismatch", async (address) => {
    const { container, errors } = await serverThenHydrated(routed(<NamesProvider names={NAMES}><AccountLink net="xrpl" address={address} full /></NamesProvider>));
    expect(container.querySelector("a")).not.toBeNull();
    expect(errors).toEqual([]);
  });
});
