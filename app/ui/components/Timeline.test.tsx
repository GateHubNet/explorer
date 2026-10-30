import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { formatUtc, shortAddress, shortHash } from "../../domain/format";
import { nameViewOf, type NameMap } from "../../domain/names";
import { NamesProvider } from "../names";
import { Timeline, type TimelineItem } from "./Timeline";

const OWNER = "rJF2XanJQGFLS5ZUdcqEzwJcTJ7aFfQvg";
const DESTINATION = "rNYbL8WZKKNNni5rb2MzcxnAEgkQC5Kq5";
const DELEGATE = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const CREATE_HASH = "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90";
const FINISH_HASH = "F0E1D2C3B4A5968778695A4B3C2D1E0FF0E1D2C3B4A5968778695A4B3C2D1E0F";

// 2026-10-09 09:34:12 UTC and the moments around it, unix seconds.
const CREATED = Date.UTC(2026, 9, 9, 9, 34, 12) / 1000;
const FINISH_AFTER = CREATED + 10 * 86_400;
const FINISHED = CREATED + 12 * 86_400;
const CANCEL_AFTER = CREATED + 20 * 86_400;

const FOOTNOTE = "Oldest first. Filled dots are transactions; dashed ones are what can still happen.";

const ITEMS: TimelineItem[] = [
  {
    kind: "tx",
    type: "EscrowCreate",
    title: "Created",
    at: CREATED,
    what: [{ t: "text", v: "Locked " }, { t: "amount", value: "1000", currency: "XRP" }, { t: "text", v: " for " }, { t: "account", v: DESTINATION }, { t: "text", v: "." }],
    by: OWNER,
    hash: CREATE_HASH,
    ledger: 107_695_660,
  },
  { kind: "mark", type: "FinishAfter", title: "Passed", at: FINISH_AFTER, whenText: formatUtc(FINISH_AFTER).slice(0, 16) + " UTC", what: [{ t: "text", v: "From here it could be finished." }] },
  {
    kind: "tx",
    type: "EscrowFinish",
    title: "Finished",
    at: FINISHED,
    what: [{ t: "text", v: "Sent " }, { t: "amount", value: "1000", currency: "XRP" }, { t: "text", v: " to the destination, and removed the escrow." }],
    by: DESTINATION,
    delegate: DELEGATE,
    hash: FINISH_HASH,
    ledger: 107_720_001,
  },
  { kind: "next", type: "EscrowCancel", title: "Not cancelled", at: CANCEL_AFTER, whenText: "From Oct 29, 2026, 09:34 UTC", what: [{ t: "text", v: "Anyone can send it then, if it has not been finished." }] },
];

const routed = (ui: ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;
const timeline = (props: Partial<Parameters<typeof Timeline>[0]> = {}) => <Timeline net="xrpl" items={ITEMS} footnote={FOOTNOTE} {...props} />;

// 13 days after the creation: the creation is 13 d ago, the mark 3 d ago, the finish 1 d ago, and the last step is in 7 days.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date((CREATED + 13 * 86_400) * 1000));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const entries = () => within(screen.getByRole("list")).getAllByRole("listitem");

describe("Timeline", () => {
  it("draws tx, mark and next items with their dot classes, by and sent by, and the footnote", () => {
    render(routed(timeline()));
    const [create, passed, finish, next] = entries() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(entries()).toHaveLength(4);

    // The dots: a filled one for a transaction, an outlined one for a mark, a dashed one for what can still happen. Decoration only.
    const dot = (entry: HTMLElement) => entry.querySelector(".timeline__dot")!;
    expect(dot(create).classList.contains("timeline__dot--tx")).toBe(true);
    expect(dot(passed).classList.contains("timeline__dot--mark")).toBe(true);
    expect(dot(finish).classList.contains("timeline__dot--tx")).toBe(true);
    expect(dot(next).classList.contains("timeline__dot--next")).toBe(true);
    for (const entry of entries()) expect(dot(entry).getAttribute("aria-hidden")).toBe("true");

    // A transaction: its type tag, its title, its time, what it did, who sent it, its hash and ledger.
    expect(create.querySelector(".type")!.textContent).toBe("EscrowCreate");
    expect(create.querySelector(".timeline__title")!.textContent).toBe("Created");
    expect(create.querySelector("time")!.textContent).toBe("2026-10-09 09:34:12 UTC");
    expect(create.querySelector(".timeline__what")!.textContent).toBe(`Locked 1,000 XRP for ${shortAddress(DESTINATION)}.`);
    const by = create.querySelector(".timeline__by")!;
    expect(by.textContent).toBe(`by ${shortAddress(OWNER)}`);
    expect(within(by as HTMLElement).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${OWNER}`);
    const ref = create.querySelector(".timeline__ref")!;
    expect(ref.textContent).toBe(`${shortHash(CREATE_HASH)} · ledger #107,695,660`);
    const [hash, ledger] = within(ref as HTMLElement).getAllByRole("link");
    expect(hash!.getAttribute("href")).toBe(`/xrpl/tx/${CREATE_HASH}`);
    expect(ledger!.getAttribute("href")).toBe("/xrpl/ledger/107695660");

    // Delegated: "by" the account the transaction is from, and "sent by" the delegate that sent it.
    const delegated = finish.querySelector(".timeline__by")!;
    expect(delegated.textContent).toBe(`by ${shortAddress(DESTINATION)} · sent by ${shortAddress(DELEGATE)}`);
    expect(within(delegated as HTMLElement).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([`/xrpl/account/${DESTINATION}`, `/xrpl/account/${DELEGATE}`]);
    // Not delegated: no "sent by".
    expect(create.textContent).not.toContain("sent by");

    // A mark and a next step are not transactions: no type-tag fill, no hash, no "by".
    for (const entry of [passed, next]) {
      expect(entry.querySelector(".type")!.classList.contains("timeline__type--ghost")).toBe(true);
      expect(entry.querySelector(".timeline__by")).toBeNull();
      expect(entry.querySelector(".timeline__ref")).toBeNull();
      expect(entry.querySelector(".timeline__dot--tx")).toBeNull();
    }
    expect(create.querySelector(".timeline__type--ghost")).toBeNull();
    expect(passed.querySelector(".timeline__title")!.textContent).toBe("Passed");
    expect(passed.textContent).toContain("2026-10-19 09:34 UTC");
    expect(next.textContent).toContain("From Oct 29, 2026, 09:34 UTC");
    expect(next.textContent).toContain("Anyone can send it then, if it has not been finished.");

    expect(screen.getByText(FOOTNOTE)).toBeTruthy();
  });

  it("draws what each event did through Sentence: the amount as an amount, the account as a chip linking to it", () => {
    render(routed(timeline()));
    const what = entries()[0]!.querySelector(".timeline__what")!;
    expect(what.querySelector(".amt")!.textContent).toBe("1,000 XRP");
    const chip = within(what as HTMLElement).getByRole("link");
    expect(chip.classList.contains("ent")).toBe(true);
    expect(chip.getAttribute("href")).toBe(`/xrpl/account/${DESTINATION}`);
  });

  it("draws the names of the page's accounts in the by line, with their marks (C15)", () => {
    const names: NameMap = {
      [OWNER]: nameViewOf({ address: OWNER, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" })!,
      [DELEGATE]: nameViewOf({ address: DELEGATE, display_name: { text: "Harborline Ops", kind: "account" }, account_name: "Harborline Ops" })!,
    };
    render(routed(<NamesProvider names={names}>{timeline()}</NamesProvider>));
    expect(screen.getByRole("link", { name: "Northpeak Treasury verified name" })).toBeTruthy();
    const delegated = entries()[2]!.querySelector(".timeline__by")!;
    expect(delegated.textContent).toContain("sent by Harborline Ops");
    expect(delegated.querySelector(".acct")).not.toBeNull();
  });

  it("keeps every link of an event's lines in a line that is underlined (WCAG 1.4.1), so that a link in a sentence is told by more than its colour", () => {
    const names: NameMap = { [OWNER]: nameViewOf({ address: OWNER, display_name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example" })! };
    render(routed(<NamesProvider names={names}>{timeline({ newer: "?marker=new", older: "?marker=old" })}</NamesProvider>));
    const links = [...screen.getByRole("list").querySelectorAll("a")];
    // the chip in what the first event did (1), the by lines (1 + 2), the hashes and ledgers (2 + 2)
    expect(links).toHaveLength(1 + 3 + 4);
    for (const link of links) expect(link.closest(".timeline__line"), link.outerHTML).not.toBeNull();
  });

  it("renders no age on the server and hydrates without a mismatch", async () => {
    const html = renderToString(routed(timeline()));
    // No age and no countdown in the stored page: only the absolute times.
    expect(html).not.toMatch(/ago|in \d|in ~|in under/);
    expect(html).toContain("2026-10-09 09:34:12 UTC");
    expect(html).toContain("From Oct 29, 2026, 09:34 UTC");
    for (const time of html.matchAll(/<time [^>]*>([^<]*)<\/time>/g)) expect(time[1]).toMatch(/^(2026-10-\d\d \d\d:\d\d:\d\d UTC)?$/);

    const { container, errors } = await serverThenHydrated(routed(timeline()));
    expect(errors).toEqual([]);
    // In the browser the ages come: a transaction's and a mark's age, and what can still happen counts down.
    expect(container.textContent).toContain("2026-10-09 09:34:12 UTC · 13 d ago");
    expect(container.textContent).toContain("2026-10-19 09:34 UTC · 3 d ago");
    expect(container.textContent).toContain("2026-10-21 09:34:12 UTC · 1 d ago");
    expect(container.textContent).toContain("From Oct 29, 2026, 09:34 UTC · in 7 days");
  });

  it("counts down to what can still happen, and says now once it has", async () => {
    const { container } = await serverThenHydrated(routed(timeline()));
    const next = container.querySelectorAll(".timeline__item")[3]!;
    expect(next.querySelector(".timeline__when")!.textContent).toBe("From Oct 29, 2026, 09:34 UTC · in 7 days");
    act(() => {
      vi.setSystemTime(new Date((CANCEL_AFTER + 1) * 1000));
      vi.advanceTimersByTime(1000);
    });
    expect(next.querySelector(".timeline__when")!.textContent).toBe("From Oct 29, 2026, 09:34 UTC · now");
  });

  it("draws a next step with no moment as its words only", () => {
    const { container } = render(routed(<Timeline net="xrpl" items={[{ kind: "next", type: "CheckCash", title: "Not cashed yet", whenText: "Until it expires", what: [] }]} footnote={FOOTNOTE} />));
    expect(container.querySelector(".timeline__when")!.textContent).toBe("Until it expires");
    expect(container.querySelector("time")).toBeNull();
    // No words of what happened: no empty paragraph.
    expect(container.querySelector(".timeline__what")).toBeNull();
  });

  it("draws Newer and Older links when given", () => {
    render(routed(timeline({ newer: "/xrpl/escrows/AB?marker=n", older: "/xrpl/escrows/AB?marker=o" })));
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe("/xrpl/escrows/AB?marker=n");
    expect(within(pager).getByRole("link", { name: "Older" }).getAttribute("href")).toBe("/xrpl/escrows/AB?marker=o");
  });

  it("draws no pager when there is no other page, and a disabled direction when only one is", () => {
    const { rerender } = render(routed(timeline()));
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();

    rerender(routed(timeline({ older: "/xrpl/escrows/AB?marker=o" })));
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByRole("link", { name: "Older" })).toBeTruthy();
    expect(within(pager).queryByRole("link", { name: "Newer" })).toBeNull();
    expect(pager.querySelector('[aria-disabled="true"]')!.textContent).toBe("Newer");
  });
});
