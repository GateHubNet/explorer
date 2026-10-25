import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amendmentsSample, SAMPLE_KEYS, SAMPLE_SIGNING_KEYS, summarySample, UNKNOWN_ID, validatorRowSample, XCB_ID } from "../../../test/support/d1-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { shortHash } from "../../domain/format";
import { validatorsHref, type ValidatorsParams } from "../../domain/validators-params";
import type { Loaded } from "../../server/account-view";
import type { UnlPublisher, ValidatorRow, ValidatorsList, ValidatorsSummary } from "../../server/api-types";
import { validatorsPage, type ValidatorsPageData } from "../../server/validators-view";
import type { NetworkInfo } from "../networks";
import type { LiveControls } from "../use-live-controls";
import { ValidatorsPage } from "./ValidatorsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };
const XAHAU_TESTNET: NetworkInfo = { id: "xahau", kind: "testnet", name: "Xahau Testnet", label: "Xahau Testnet", longName: "Xahau Testnet", dexName: "the Xahau Testnet DEX", native: "XAH", software: "xahaud" };

/** Xahau Testnet's fixed list as the data API serves it (D-env §5): the publisher `local`, with no site, no key and no expiration. */
const FIXED_LIST: UnlPublisher = { id: "local", url: "", public_key: "", status: "ok", sequence: 1, version: 1, fetched: "2026-10-19T15:51:26.114Z", validators: 4, seen_24h: 4 };

const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED: Loaded<never> = { state: "failed" };

/** A copy of an object without some of its keys (D1 leaves a key out; it never sends `null`). */
function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

const [KEY_NORTH, KEY_SHORE, KEY_TIDE, KEY_NAMELESS, KEY_QUIET] = SAMPLE_KEYS.slice(0, 5) as [string, string, string, string, string];

/** 2026-10-19 15:54:30 UTC: eleven minutes before the flag ledger of the sample summary (16:05:28). */
const NOW = Date.UTC(2026, 9, 19, 15, 54, 30) / 1000;
const seen = (secondsAgo: number) => new Date((NOW - secondsAgo) * 1000).toISOString();

/**
 * Five validators in D1's order. `northpeak`: both lists, domain verified, latest, fee votes as now, two amendments (one nobody named), seen 50 s ago. `shoreline`: one list, on
 * the negative UNL, domain not verified, an agreement that counts part of its window, a higher reserve vote and a lower one, seen 9 min ago. `tidewater`: off the UNL, domain not
 * checked yet, no fee vote, no amendment, never seen. `nameless`: no domain, votes for DID. `quiet`: a member of the UNL that was never seen: no version, no score, no vote.
 */
function fleet(): ValidatorRow[] {
  const north = validatorRowSample({ last_seen: seen(50) });
  const shore = validatorRowSample({
    validation_public_key: KEY_SHORE,
    domain: "shoreline.example",
    signing_key: SAMPLE_SIGNING_KEYS[1],
    domain_verification: { status: "unverified", reason: "not_listed", toml_url: "https://shoreline.example/.well-known/xrp-ledger.toml", checked: "2026-10-19T15:00:00Z" },
    unl_lists: ["vl.ripple.com"],
    negative_unl: true,
    version: "3.4.0",
    version_latest: false,
    agreement_24h: { missed: 100, total: 200, score: "0.5000", incomplete: true, partial: 0 },
    fee_vote: { ledger_index: 107748095, base_fee: "0.00001", reserve_base: "2", reserve_inc: "0.1" },
    amendment_votes: { ledger_index: 107748095, yes: [{ id: XCB_ID, name: "XChainBridge" }] },
    last_seen: seen(540),
  });
  const tide: ValidatorRow = {
    ...without(validatorRowSample(), "fee_vote", "last_seen"),
    validation_public_key: KEY_TIDE,
    domain: "tidewater.example",
    signing_key: SAMPLE_SIGNING_KEYS[2],
    domain_verification: { status: "pending", toml_url: "https://tidewater.example/.well-known/xrp-ledger.toml" },
    unl: false,
    unl_lists: [],
    version: "3.4.0",
    version_latest: false,
    amendment_votes: { ledger_index: 107748095, yes: [] },
  };
  const nameless: ValidatorRow = {
    ...without(validatorRowSample(), "domain", "domain_verification"),
    validation_public_key: KEY_NAMELESS,
    signing_key: SAMPLE_SIGNING_KEYS[3],
    unl: false,
    unl_lists: [],
    amendment_votes: { ledger_index: 107748095, yes: [{ id: amendmentsSample().amendments[1]!.id, name: "DID" }] },
    last_seen: seen(3600),
  };
  const quiet: ValidatorRow = {
    validation_public_key: KEY_QUIET,
    agreement_1h: { missed: 0, total: 0, incomplete: true, partial: 0 },
    agreement_24h: { missed: 0, total: 0, incomplete: true, partial: 0 },
    unl: true,
    agreement_30d: { missed: 0, total: 0, incomplete: true, partial: 0 },
    unl_lists: ["unl.xrplf.org", "vl.ripple.com"],
    negative_unl: false,
  };
  return [north, shore, tide, nameless, quiet];
}

const listOf = (validators: ValidatorRow[], marker?: string): ValidatorsList => ({ result: "success", count: validators.length, ...(marker !== undefined && { marker }), validators });

/** A summary whose negative UNL is `shoreline`, so that the Negative UNL tile names a validator the list has. */
const summary = (over: Partial<ValidatorsSummary> = {}): ValidatorsSummary =>
  summarySample({
    negative_unl: [{ validation_public_key: KEY_SHORE, first_ledger: 107747000 }],
    negative_unl_pending: { to_reenable: KEY_SHORE },
    ...over,
  });

type Input = Parameters<typeof validatorsPage>[0];
function build(over: Partial<Input> = {}): ValidatorsPageData {
  return validatorsPage({
    network: XRPL,
    params: { scope: "unl" },
    summary: ok(summary()),
    list: ok(listOf(fleet())),
    amendments: ok(amendmentsSample()),
    ...over,
  });
}

/** What the route hands the page: the builder's data, the anchor the loader read and the build. */
const loaded = (data: ValidatorsPageData) => ({ ...data, anchor: { lastValidated: 107748183, closeTime: NOW }, build: "test-build" });

// ---- Rendering --------------------------------------------------------------------------------------------------------------------------

const controls = (over: Partial<LiveControls> = {}): LiveControls => ({
  paused: false,
  held: false,
  notice: "",
  failures: 0,
  onTogglePause: vi.fn(),
  onHold: vi.fn(),
  ...over,
});

/**
 * The page in a data router, drawn at once: its route's data is given (`hydrationData`), as the document gives it in the browser. The `loader` is what a Retry runs again, and
 * `at` the address the router stands at.
 */
function mount(data: ValidatorsPageData, props: { live?: LiveControls; loader?: () => null; at?: string } = {}) {
  const at = props.at ?? validatorsHref(data.network.id, data.params);
  const router = createMemoryRouter([{ path: "*", element: <ValidatorsPage data={loaded(data)} live={props.live ?? controls()} />, loader: props.loader ?? (() => null) }], {
    initialEntries: [at],
    hydrationData: { loaderData: { "0": null } },
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

const routed = (ui: ReactElement, at = "/xrpl/validators") => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [at] })} />;
const htmlOf = (data: ValidatorsPageData, live = controls()) => renderToString(routed(<ValidatorsPage data={loaded(data)} live={live} />));

const region = (name: string) => screen.getByRole("region", { name });
const card = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;
const table = () => screen.getByRole("table", { name: "Validators" });
/** The row of the validator whose link says `name`. */
const rowOf = (name: string | RegExp) => within(table()).getByRole("link", { name }).closest<HTMLElement>('[role="row"]')!;
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");
const text = (element: Element) => element.textContent ?? "";

/** What a tile of the overview says: its label, figure and note. */
function tile(label: string) {
  const element = within(region("Network overview")).getByText(label).closest(".stat") as HTMLElement;
  const at = (selector: string) => element.querySelector(selector)?.textContent ?? null;
  return { element, value: at(".stat__value"), sub: at(".stat__sub") };
}

// ---- The heading, the live row and the notices -----------------------------------------------------------------------------------------------

describe("ValidatorsPage, the heading", () => {
  it("has the breadcrumb XRPL / Network / Validators, the middle one a link to the network page", () => {
    mount(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    const items = crumbs.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["XRPL/", "Network/", "Validators"]);
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/xrpl/network");
    expect(crumbs.getByText("Validators").getAttribute("aria-current")).toBe("page");
  });

  it("has the one h1, the builder's intro and the link to the amendments", () => {
    const data = build();
    mount(data);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Validators"]);
    expect(screen.getByText(/^The default UNL is the list of validators rippled trusts out of the box, published by unl\.xrplf\.org and vl\.ripple\.com\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Amendments →" }).getAttribute("href")).toBe("/xrpl/amendments");
  });

  it("is Xahau's on Xahau: its name, its software, and the link to its own amendments", () => {
    const one = summarySample({ unl: { ...summarySample().unl, publishers: [summarySample().unl.publishers[1]!] } });
    mount(build({ network: XAHAU, summary: ok(one) }));
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Xahau" }).getAttribute("href")).toBe("/xahau");
    expect(screen.getByText(/validators xahaud trusts out of the box, published by vl\.ripple\.com\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Amendments →" }).getAttribute("href")).toBe("/xahau/amendments");
  });

  it("has the live row under the heading: the dot and 'Live · updates every 10 s'", () => {
    const { container } = mount(build());
    const row = container.querySelector(".hero__status-row")!;
    expect(row.querySelector(".hero__status")!.textContent).toBe("Live · updates every 10 s");
    expect(row.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("says 'Paused while you look at the table' while held, and the dot goes quiet", async () => {
    const { container } = mount(build(), { live: controls({ held: true }) });
    expect(container.querySelector(".hero__held")!.textContent).toBe("Paused while you look at the table");
    expect(container.querySelector(".hero__dot")!.classList.contains("is-paused")).toBe(true);
    expect(await screen.findByRole("button", { name: "Pause live updates" })).toBeTruthy();
  });

  it("has a pause button that calls the page's handler, and the one status of the live row", async () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.click(await screen.findByRole("button", { name: "Pause live updates" }));
    expect(live.onTogglePause).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("ValidatorsPage, the notices of the publishers", () => {
  it("shows each of the builder's notices as a note with an icon, and not as an alert", () => {
    const data = build();
    const { container } = mount(data);
    const notes = Array.from(container.querySelectorAll(".notice"));
    expect(data.summary.state === "ok" && data.summary.notices.length).toBeGreaterThan(0);
    expect(notes.map((note) => text(note.querySelector(".notice__body")!))).toEqual(data.summary.state === "ok" ? data.summary.notices : []);
    expect(notes[0]!.querySelector(".notice__icon svg")).not.toBeNull();
    expect(notes[0]!.getAttribute("role")).toBeNull();
    expect(notes[0]!.classList.contains("notice--warning")).toBe(true);
    expect(text(notes[0]!)).toContain("unl.xrplf.org's list expired on Oct 18, 2026.");
  });

  it("shows none when every list is current, or when the summary did not load", () => {
    const current = summarySample({ unl: { ...summarySample().unl, publishers: summarySample().unl.publishers.map((p) => ({ ...p, status: "ok" as const })) } });
    expect(mount(build({ summary: ok(current) })).container.querySelector(".notice:not(.notice--error)")).toBeNull();
    cleanup();
    expect(mount(build({ summary: FAILED })).container.querySelector(".notice:not(.notice--error)")).toBeNull();
  });
});

// ---- The overview -------------------------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, the network overview", () => {
  it("is a section of six tiles of a figure each, in the order of the board, with the builder's figures and notes", () => {
    const data = build();
    mount(data);
    const tiles = Array.from(region("Network overview").querySelectorAll(".stat"));
    expect(tiles).toHaveLength(6);
    expect(tiles.every((element) => element.classList.contains("stat--figure"))).toBe(true);
    const tokens = data.summary.state === "ok" ? data.summary.tiles : [];
    expect(tiles.map((element) => element.querySelector(".stat__label")!.textContent)).toEqual([
      "Validators seen, last 24 h",
      "On the default UNL",
      "Quorum",
      "Negative UNL",
      "Base / owner reserve",
      "Next flag ledger",
    ]);
    expect(tiles.map((element) => element.querySelector(".stat__value")!.textContent)).toEqual(tokens.map((t) => t.value));
    expect(tile("Validators seen, last 24 h")).toMatchObject({ value: "54", sub: "34 on the default UNL, 20 others" });
    expect(tile("On the default UNL")).toMatchObject({ value: "34 / 35", sub: "seen in 24 h, of those listed by unl.xrplf.org and vl.ripple.com" });
    expect(tile("Quorum")).toMatchObject({ value: "28 of 35", sub: "validations a ledger needs" });
    expect(tile("Base / owner reserve")).toMatchObject({ value: "1 / 0.2 XRP", sub: "base fee 10 drops" });
    expect(tile("Next flag ledger").value).toBe("#107,748,352");
  });

  it("names the validators of the Negative UNL tile as links to their pages", () => {
    mount(build());
    const links = within(tile("Negative UNL").element).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["shoreline.example", `/xrpl/validators/${KEY_SHORE}`],
      ["shoreline.example", `/xrpl/validators/${KEY_SHORE}`],
    ]);
    expect(tile("Negative UNL").sub).toBe("shoreline.example is discounted while it is offline · shoreline.example to be re-enabled at the next flag ledger");
  });

  it("counts down to the flag ledger in the browser and prints its time in the stored HTML", () => {
    const html = htmlOf(build());
    expect(html).toContain("expected 16:05 UTC");
    expect(html).not.toMatch(/in ~\d+ min/);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW * 1000);
    mount(build());
    expect(tile("Next flag ledger").sub).toBe("in ~11 min · fee and amendment votes are counted there");
  });

  it("is Xahau's in XAH", () => {
    mount(build({ network: XAHAU, summary: ok(summary({ fees: { base_fee: "0.00001", reserve_base: "10", reserve_inc: "2" } })) }));
    expect(tile("Base / owner reserve").value).toBe("10 / 2 XAH");
  });

  it("shows a dash and 'Couldn’t load' on each tile when the summary did not load, with one error under the grid", () => {
    mount(build({ summary: FAILED }));
    const tiles = Array.from(region("Network overview").querySelectorAll(".stat"));
    expect(tiles).toHaveLength(6);
    expect(tiles.map((element) => [element.querySelector(".stat__value")!.textContent, element.querySelector(".stat__sub")!.textContent])).toEqual(
      Array.from({ length: 6 }, () => ["—", "Couldn’t load"]),
    );
    const errors = screen.getAllByRole("alert").filter((alert) => text(alert).includes("the network overview"));
    expect(errors).toHaveLength(1);
    expect(text(errors[0]!)).toBe("Couldn’t load the network overview.Retry");
    expect(region("Network overview").contains(errors[0]!)).toBe(false);
    expect(region("Network overview").compareDocumentPosition(errors[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the dash of a figure the summary left out, with the builder's words", () => {
    mount(build({ summary: ok(without(summary(), "fees", "next_flag_ledger") as ValidatorsSummary) }));
    expect(tile("Base / owner reserve")).toMatchObject({ value: "—", sub: "not known yet" });
    expect(tile("Next flag ledger")).toMatchObject({ value: "—", sub: "not known yet" });
  });
});

// ---- The versions card ------------------------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, the versions card", () => {
  it("is a chart card with the share bar of both rows, the total and its word in each label, and the legend", () => {
    const { container } = mount(build());
    const versions = card("Validator software versions");
    expect(within(versions).getByText("/v2/network/validators/summary")).toBeTruthy();
    const rows = Array.from(versions.querySelectorAll(".share__row:not(.share__row--axis)"));
    expect(rows.map((row) => Array.from(row.querySelectorAll(".share__name > *"), (el) => el.textContent))).toEqual([
      ["UNL", "35 validators"],
      ["All", "54 validators"],
    ]);
    expect(rows.map((row) => row.querySelectorAll(".share__seg").length)).toEqual([3, 4]);
    expect(Array.from(versions.querySelectorAll(".legend__item"), (item) => item.textContent)).toEqual(["3.5.0-rc1", "3.4.1", "3.4.0", "Other"]);
    // The bar's segments wear the slots the builder gave their versions.
    const data = build();
    const slots = data.summary.state === "ok" ? data.summary.versions.chart.rows[1]!.segments.map((s) => String(s.slot)) : [];
    expect(Array.from(rows[1]!.querySelectorAll(".share__seg"), (seg) => seg.getAttribute("data-slot"))).toEqual(slots);
    expect(container.querySelector(".share")).not.toBeNull();
  });

  it("says '1 validator' for a row of one", () => {
    mount(build({ summary: ok(summary({ versions: [{ version: "3.4.1", unl: 1, all: 2 }], versions_unknown: { unl: 0, all: 0 } })) }));
    expect(Array.from(card("Validator software versions").querySelectorAll(".share__name > span"), (el) => el.textContent)).toEqual(["1 validator", "2 validators"]);
  });

  it("has its own table view: a row for each version and for Unknown, each with the swatch of its group, behind the Chart/Table radios", () => {
    const data = build();
    mount(data);
    const versions = card("Validator software versions");
    expect(versions.querySelector('input[type="radio"][value="table"]')).not.toBeNull();
    const grid = within(versions).getByRole("table", { name: "Validator software versions" });
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Version", "UNL", "UNL share", "All", "All share"]);
    const body = within(grid).getAllByRole("row").slice(1);
    const expected = data.summary.state === "ok" ? data.summary.versions.table : [];
    expect(expected.map((r) => r.version)).toEqual(["3.5.0-rc1", "3.4.1", "3.4.0", "Unknown"]);
    expect(body.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual(expected.map((r) => [r.version, r.unl, r.unlShare, r.all, r.allShare]));
    expect(body.map((row) => row.querySelector("[data-slot]")!.getAttribute("data-slot"))).toEqual(expected.map((r) => String(r.slot)));
    expect(body.every((row) => row.querySelector("[data-slot]")!.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("ends with the builder's notes", () => {
    const data = build();
    mount(data);
    const notes = Array.from(card("Validator software versions").querySelectorAll(".chart__notes p"), (p) => p.textContent);
    expect(notes).toEqual(data.summary.state === "ok" ? data.summary.versions.notes : []);
    expect(notes.at(-1)).toBe("Latest release on the UNL: 3.4.1.");
  });

  it("shows a section error in place of the card when the summary did not load", () => {
    mount(build({ summary: FAILED }));
    const versions = card("Validator software versions");
    expect(versions.querySelector(".share")).toBeNull();
    expect(text(within(versions).getByRole("alert"))).toBe("Couldn’t load the software versions.Retry");
    expect(versions.querySelector('input[type="radio"]')).toBeNull();
  });

  it("draws the chart in the stored HTML with both views, and no age or countdown", () => {
    const html = htmlOf(build());
    expect(html).toContain('class="share__seg"');
    expect(html).toContain('value="table"');
    expect(html).toContain("UNL share");
    expect(html).not.toMatch(/\bago\b/);
  });

  it("fills with every version unknown: a bar of Other alone, and the table's one row", () => {
    mount(build({ summary: ok(summary({ versions: [], versions_unknown: { unl: 35, all: 54 } })) }));
    const versions = card("Validator software versions");
    expect(Array.from(versions.querySelectorAll(".share__seg"), (seg) => seg.getAttribute("data-slot"))).toEqual(["other", "other"]);
    const rows = within(within(versions).getByRole("table", { name: "Validator software versions" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => text(row))).toEqual(["Unknown35100.0%54100.0%"]);
    expect(within(versions).getByText("“Other” is the validators whose version is not known.")).toBeTruthy();
  });
});

// ---- The validators card: filters ------------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, the scope links", () => {
  it("are 'UNL {n}' and 'All {n}' in a segmented control, the current one marked, counted from the list", () => {
    mount(build());
    const group = within(screen.getByRole("group", { name: "Which validators" }));
    const links = group.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["UNL 3", "All 5"]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["true", null]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/xrpl/validators", "/xrpl/validators?scope=all"]);
  });

  it("mark All on the All scope, and keep the other filters in both links", () => {
    const params: ValidatorsParams = { scope: "all", publisher: "vl.ripple.com", amendment: "XChainBridge", q: "north peak" };
    mount(build({ params }));
    const links = within(screen.getByRole("group", { name: "Which validators" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, "true"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/xrpl/validators?publisher=vl.ripple.com&amendment=XChainBridge&q=north+peak",
      "/xrpl/validators?scope=all&publisher=vl.ripple.com&amendment=XChainBridge&q=north+peak",
    ]);
  });

  it("count the scope, not the filtered rows", () => {
    mount(build({ params: { scope: "unl", q: "tidewater" } }));
    expect(within(screen.getByRole("group", { name: "Which validators" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["UNL 3", "All 5"]);
  });

  it("leave the counts out when the list did not load", () => {
    mount(build({ list: FAILED }));
    expect(within(screen.getByRole("group", { name: "Which validators" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["UNL", "All"]);
  });
});

describe("ValidatorsPage, the filter form", () => {
  const form = () => screen.getByRole("search", { name: "Filter validators" });
  /** A `<select>` by its label, as what the tests read of it (its own type clashes with `Element.remove` in this project's DOM types). */
  const select = (label: string) => within(form()).getByLabelText(label) as unknown as { name: string; value: string; options: ArrayLike<HTMLOptionElement> };

  it("is a GET form to the list's own address, role search, with a labelled search field, 'Listed by', 'Votes yes for' and Apply", () => {
    mount(build());
    expect(form().tagName).toBe("FORM");
    expect(form().getAttribute("method")).toBe("get");
    expect(form().getAttribute("action")).toBe("/xrpl/validators");
    const field = within(form()).getByLabelText("Search validators by domain or key") as HTMLInputElement;
    expect(field.name).toBe("q");
    expect(field.placeholder).toBe("Domain or key");
    expect(field.getAttribute("type")).toBe("search");
    expect(within(form()).getByRole("button", { name: "Apply" }).getAttribute("type")).toBe("submit");
    expect(within(form()).getByLabelText("Listed by")).toBeTruthy();
    expect(within(form()).getByLabelText("Votes yes for")).toBeTruthy();
  });

  it("has a landmark of its own, besides the table's and the cards'", () => {
    mount(build());
    expect(screen.getAllByRole("search")).toHaveLength(1);
  });

  it("lists 'any publisher' first and S's ids, and 'any amendment' first and A's amendments with their share of yes", () => {
    const data = build();
    mount(data);
    const publisher = select("Listed by");
    expect(publisher.name).toBe("publisher");
    expect(Array.from(publisher.options, (o) => [o.value, o.textContent])).toEqual([
      ["", "any publisher"],
      ["unl.xrplf.org", "unl.xrplf.org"],
      ["vl.ripple.com", "vl.ripple.com"],
    ]);
    const amendment = select("Votes yes for");
    expect(amendment.name).toBe("amendment");
    const options = data.amendments.state === "ok" ? data.amendments.options : [];
    expect(Array.from(amendment.options, (o) => [o.value, o.textContent])).toEqual([["", "any amendment"], ...options.map((o) => [o.value, o.label])]);
    expect(options[0]).toEqual({ value: "XChainBridge", label: "XChainBridge · 88.6%" });
  });

  it("has the view's own values in the fields, uncontrolled", () => {
    mount(build({ params: { scope: "unl", publisher: "vl.ripple.com", amendment: "XChainBridge", q: "north" } }));
    expect((within(form()).getByLabelText("Search validators by domain or key") as HTMLInputElement).value).toBe("north");
    expect(select("Listed by").value).toBe("vl.ripple.com");
    expect(select("Votes yes for").value).toBe("XChainBridge");
  });

  it("keeps what the visitor typed through a beat that brings the same view", () => {
    const first = build();
    let update!: (next: ValidatorsPageData) => void;
    function Host() {
      const [current, setCurrent] = useState(first);
      update = (next) => act(() => setCurrent(next));
      return <ValidatorsPage data={loaded(current)} live={controls()} />;
    }
    render(routed(<Host />));
    const field = within(form()).getByLabelText("Search validators by domain or key") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "half a wor" } });
    update(build({ summary: ok(summary({ updated: "2026-10-19T15:55:00Z" })) }));
    expect((within(form()).getByLabelText("Search validators by domain or key") as HTMLInputElement).value).toBe("half a wor");
  });

  it("has a hidden scope=all on the All scope, and none on the UNL", () => {
    mount(build({ params: { scope: "all" } }));
    const hidden = Array.from(form().querySelectorAll<HTMLInputElement>('input[type="hidden"]'));
    expect(hidden.map((input) => [input.name, input.value])).toEqual([["scope", "all"]]);
    cleanup();
    mount(build());
    expect(form().querySelector('input[type="hidden"]')).toBeNull();
  });

  it("has no 'Listed by' with fewer than two publishers (Xahau has one)", () => {
    const one = summarySample({ unl: { ...summarySample().unl, publishers: [summarySample().unl.publishers[1]!] } });
    mount(build({ network: XAHAU, summary: ok(one) }));
    expect(within(form()).queryByLabelText("Listed by")).toBeNull();
    expect(within(form()).getByLabelText("Votes yes for")).toBeTruthy();
  });

  it("has no 'Listed by' when the summary did not load, and applies a publisher it was given", () => {
    mount(build({ summary: FAILED, params: { scope: "unl", publisher: "vl.ripple.com" } }));
    expect(within(form()).queryByLabelText("Listed by")).toBeNull();
    expect(Array.from(form().querySelectorAll<HTMLInputElement>('input[type="hidden"]'), (input) => [input.name, input.value])).toEqual([["publisher", "vl.ripple.com"]]);
  });

  it("has no 'Votes yes for' when the amendments did not load, and keeps an amendment it was given", () => {
    mount(build({ amendments: FAILED, params: { scope: "unl", amendment: "XChainBridge" } }));
    expect(within(form()).queryByLabelText("Votes yes for")).toBeNull();
    expect(Array.from(form().querySelectorAll<HTMLInputElement>('input[type="hidden"]'), (input) => [input.name, input.value])).toEqual([["amendment", "XChainBridge"]]);
  });

  it("has no 'Votes yes for' when nothing is being decided: the list of options is empty", () => {
    mount(build({ amendments: ok(amendmentsSample({ amendments: amendmentsSample().amendments.filter((a) => a.status === "enabled"), counts: { enabled: 2, majority: 0, voting: 0, obsolete: 0, unknown: 0 }, count: 2 })) }));
    expect(within(form()).queryByLabelText("Votes yes for")).toBeNull();
    expect(within(form()).getByLabelText("Listed by")).toBeTruthy();
  });

  it("leads 'Clear filters' to the scope alone, and only while a filter is set", () => {
    mount(build());
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
    cleanup();
    mount(build({ params: { scope: "all", q: "north" } }));
    expect(screen.getAllByRole("link", { name: "Clear filters" }).map((link) => link.getAttribute("href"))).toEqual(["/xrpl/validators?scope=all"]);
  });
});

describe("ValidatorsPage, Apply", () => {
  const apply = (fill: (form: HTMLElement) => void, data = build()) => {
    const { router } = mount(data);
    const form = screen.getByRole("search", { name: "Filter validators" });
    fill(form);
    const submitted = fireEvent.submit(form);
    return { router, submitted };
  };
  const type = (form: HTMLElement, value: string) =>
    fireEvent.change(within(form).getByLabelText("Search validators by domain or key"), { target: { value } });
  const choose = (form: HTMLElement, label: string, value: string) => fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  const here = (router: ReturnType<typeof mount>["router"]) => router.state.location.pathname + router.state.location.search;

  it("navigates to the canonical address of the fields, in the browser, and not to the form's own query", async () => {
    const { router, submitted } = apply((form) => type(form, "north"));
    // The default was prevented: the browser does not reload the page with `?q=north` itself.
    expect(submitted).toBe(false);
    await act(async () => {});
    expect(here(router)).toBe(validatorsHref("xrpl", { scope: "unl", q: "north" }));
    expect(here(router)).toBe("/xrpl/validators?q=north");
  });

  it("drops empty fields and the default scope, trims the text and orders the rest: no redirect is left to ask for", async () => {
    const { router } = apply((form) => {
      type(form, "  north peak  ");
      choose(form, "Listed by", "vl.ripple.com");
      choose(form, "Votes yes for", "XChainBridge");
    });
    await act(async () => {});
    expect(here(router)).toBe("/xrpl/validators?publisher=vl.ripple.com&amendment=XChainBridge&q=north+peak");
    cleanup();
    const cleared = apply((form) => type(form, "   "), build({ params: { scope: "unl", q: "north" } }));
    await act(async () => {});
    expect(here(cleared.router)).toBe("/xrpl/validators");
  });

  it("keeps the All scope through its hidden field", async () => {
    const { router } = apply((form) => type(form, "tide"), build({ params: { scope: "all" } }));
    await act(async () => {});
    expect(here(router)).toBe("/xrpl/validators?scope=all&q=tide");
  });

  it("keeps a filter whose field is not drawn", async () => {
    const { router } = apply((form) => type(form, "x"), build({ amendments: FAILED, params: { scope: "unl", amendment: "XChainBridge" } }));
    await act(async () => {});
    expect(here(router)).toBe("/xrpl/validators?amendment=XChainBridge&q=x");
  });

  it("keeps the scroll where it is", async () => {
    const { router } = apply((form) => type(form, "north"));
    await act(async () => {});
    expect(router.state.preventScrollReset).toBe(true);
  });

  it("is the Xahau list's on Xahau", async () => {
    const { router } = apply((form) => type(form, "n"), build({ network: XAHAU }));
    await act(async () => {});
    expect(here(router)).toBe("/xahau/validators?q=n");
  });
});

// ---- The table -----------------------------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, the table", () => {
  it("is a live table of the board's columns, scrolling inside its card, with a row for each validator in the builder's order", () => {
    const data = build();
    mount(data);
    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Validator",
      "Version",
      "Agreement 24 h",
      "Fee votes · base / owner / fee",
      "Amendment votes",
      "Last seen",
    ]);
    expect(region("Validators, scrollable table").getAttribute("tabindex")).toBe("0");
    expect((table() as HTMLElement).style.minWidth).toBe("980px");
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-key"))).toEqual(data.list.state === "ok" ? data.list.rows.map((r) => r.validation_public_key) : []);
    expect(rows.map((row) => row.getAttribute("data-key"))).toEqual([KEY_NORTH, KEY_SHORE, KEY_QUIET]);
  });

  it("shows only the UNL on the UNL scope and every validator on the All scope", () => {
    mount(build({ params: { scope: "all" } }));
    expect(within(table()).getAllByRole("row").slice(1).map((row) => row.getAttribute("data-key"))).toEqual([KEY_NORTH, KEY_SHORE, KEY_TIDE, KEY_NAMELESS, KEY_QUIET]);
  });

  describe("the validator column", () => {
    const all = () => build({ params: { scope: "all" } });

    it("has the domain as a link to the validator's page, the short master key under it in mono", () => {
      mount(build());
      const row = rowOf("northpeak.example");
      const link = within(row).getByRole("link", { name: "northpeak.example" });
      expect(link.getAttribute("href")).toBe(`/xrpl/validators/${KEY_NORTH}`);
      expect(text(cellsOf(row)[0]!)).toContain(shortHash(KEY_NORTH));
      expect(cellsOf(row)[0]!.querySelector(".validators__sub")!.classList.contains("mono")).toBe(true);
    });

    it("words the UNL tag of a row: mainnet as ever, and 'Listed by the fixed list' on Xahau Testnet", () => {
      mount(build());
      const tagOf = (name: string) => rowOf(name).querySelector(".tag")!;
      expect(text(tagOf("northpeak.example"))).toBe("UNL Listed by unl.xrplf.org and vl.ripple.com");
      expect(tagOf("northpeak.example").getAttribute("title")).toBe("Listed by unl.xrplf.org and vl.ripple.com");
      cleanup();

      const fixed = validatorRowSample({ unl_lists: ["local"] });
      mount(build({ network: XAHAU_TESTNET, summary: ok(summary({ unl: { trusted: 4, publishers: [FIXED_LIST] } })), list: ok(listOf([fixed])) }));
      expect(text(tagOf("northpeak.example"))).toBe("UNL Listed by the fixed list");
      expect(tagOf("northpeak.example").getAttribute("title")).toBe("Listed by the fixed list");
    });

    it("says 'verified' with a check, 'not verified' with an alert and 'not checked yet' with a clock: an icon and a word each", () => {
      mount(all());
      const marks = (name: string) => Array.from(rowOf(name).querySelectorAll(".st"));
      const verified = marks("northpeak.example").find((st) => text(st).includes("verified") && !text(st).includes("not"))!;
      expect(text(verified)).toBe("verified");
      expect(verified.classList.contains("st--ok")).toBe(true);
      expect(verified.querySelector("svg")).not.toBeNull();
      const unverified = marks("shoreline.example").find((st) => text(st) === "not verified")!;
      expect(unverified.classList.contains("st--quiet")).toBe(true);
      expect(unverified.querySelector("svg")).not.toBeNull();
      const pending = marks("tidewater.example").find((st) => text(st) === "not checked yet")!;
      expect(pending.classList.contains("st--quiet")).toBe(true);
      expect(pending.querySelector("svg")).not.toBeNull();
    });

    it("names a validator with no domain by its short key in mono, with 'no domain' under it and no badge", () => {
      mount(all());
      const row = rowOf(shortHash(KEY_NAMELESS));
      const link = within(row).getByRole("link", { name: shortHash(KEY_NAMELESS) });
      expect(link.classList.contains("mono")).toBe(true);
      expect(link.getAttribute("href")).toBe(`/xrpl/validators/${KEY_NAMELESS}`);
      expect(cellsOf(row)[0]!.querySelector(".validators__sub")!.textContent).toBe("no domain");
      expect(cellsOf(row)[0]!.querySelector(".st")).toBeNull();
    });

    it("has the UNL tag with a shield and the publishers that list it as hidden text after the word; none off the UNL", () => {
      mount(all());
      const tag = Array.from(rowOf("northpeak.example").querySelectorAll(".tag")).find((t) => text(t).startsWith("UNL"))!;
      expect(tag.querySelector("svg")).not.toBeNull();
      expect(tag.firstChild!.nodeType).toBe(Node.ELEMENT_NODE);
      expect(text(tag)).toBe("UNL Listed by unl.xrplf.org and vl.ripple.com");
      expect(tag.querySelector(".sr")!.textContent).toBe(" Listed by unl.xrplf.org and vl.ripple.com");
      expect(tag.getAttribute("title")).toBe("Listed by unl.xrplf.org and vl.ripple.com");
      expect(text(Array.from(rowOf("shoreline.example").querySelectorAll(".tag")).find((t) => text(t).startsWith("UNL"))!)).toBe("UNL Listed by vl.ripple.com");
      expect(Array.from(rowOf("tidewater.example").querySelectorAll(".tag")).some((t) => text(t).startsWith("UNL"))).toBe(false);
    });

    it("has the Negative UNL tag on the validator that is on it, and on no other", () => {
      mount(all());
      const negative = (name: string) => Array.from(rowOf(name).querySelectorAll(".tag")).some((t) => text(t) === "Negative UNL");
      expect(negative("shoreline.example")).toBe(true);
      expect(negative("northpeak.example")).toBe(false);
      expect(negative("tidewater.example")).toBe(false);
    });
  });

  describe("the version and agreement columns", () => {
    it("shows the version in mono and 'latest' with its icon for the newest release only", () => {
      mount(build({ params: { scope: "all" } }));
      const north = cellsOf(rowOf("northpeak.example"))[1]!;
      expect(north.querySelector(".mono")!.textContent).toBe("3.4.1");
      const latest = north.querySelector(".st")!;
      expect(text(latest)).toBe("latest");
      expect(latest.classList.contains("st--ok")).toBe(true);
      expect(latest.querySelector("svg")).not.toBeNull();
      const shore = cellsOf(rowOf("shoreline.example"))[1]!;
      expect(shore.querySelector(".mono")!.textContent).toBe("3.4.0");
      expect(shore.querySelector(".st")).toBeNull();
    });

    it("shows a dash for a validator that reported no version", () => {
      mount(build());
      expect(text(cellsOf(rowOf(shortHash(KEY_QUIET)))[1]!)).toBe("—");
    });

    it("shows the agreement as the builder wrote it, right-aligned, with 'incomplete' and its icon under a partial window", () => {
      mount(build());
      const north = cellsOf(rowOf("northpeak.example"))[2]!;
      expect(text(north)).toBe("99.99%");
      expect(north.classList.contains("is-end")).toBe(true);
      const shore = cellsOf(rowOf("shoreline.example"))[2]!;
      expect(text(shore)).toBe("50.00%incomplete");
      expect(shore.querySelector(".st--quiet svg")).not.toBeNull();
      const quiet = cellsOf(rowOf(shortHash(KEY_QUIET)))[2]!;
      expect(text(quiet)).toBe("—incomplete");
    });
  });

  describe("the fee votes", () => {
    it("shows base / owner / fee in bare numbers, with no arrow where the vote is the fee now", () => {
      mount(build());
      const cell = cellsOf(rowOf("northpeak.example"))[3]!;
      expect(text(cell)).toBe("1/ 0.2/ 10");
      expect(cell.querySelector(".fee-arrow")).toBeNull();
      expect(cell.querySelector(".sr")).toBeNull();
    });

    it("puts an arrow after a vote above or below the fee now, hidden from a screen reader, with the words as hidden text", () => {
      mount(build());
      const cell = cellsOf(rowOf("shoreline.example"))[3]!;
      const arrows = Array.from(cell.querySelectorAll(".fee-arrow"));
      expect(arrows.map((arrow) => [arrow.textContent, arrow.getAttribute("aria-hidden")])).toEqual([
        ["↑", "true"],
        ["↓", "true"],
      ]);
      expect(Array.from(cell.querySelectorAll(".sr"), (sr) => sr.textContent)).toEqual([", higher than now", ", lower than now"]);
    });

    it("shows a dash for a validator with no fee vote, and says so as hidden text", () => {
      mount(build({ params: { scope: "all" } }));
      const cell = cellsOf(rowOf("tidewater.example"))[3]!;
      expect(cell.querySelector("[aria-hidden]")!.textContent).toBe("—");
      expect(text(cell)).toBe("—no fee vote recorded");
      expect(cell.querySelector(".sr")!.textContent).toBe("no fee vote recorded");
    });

    it("compares nothing when the summary did not load: the votes without arrows", () => {
      mount(build({ summary: FAILED }));
      const cell = cellsOf(rowOf("shoreline.example"))[3]!;
      expect(text(cell)).toBe("2/ 0.1/ 10");
      expect(cell.querySelector(".fee-arrow")).toBeNull();
    });
  });

  describe("the amendment votes", () => {
    it("is a disclosure '2 yes' that lists each amendment as a link to its page, by name else by ID", () => {
      mount(build());
      const cell = cellsOf(rowOf("northpeak.example"))[4]!;
      const details = cell.querySelector("details")!;
      expect(details.hasAttribute("open")).toBe(false);
      expect(details.querySelector("summary")!.textContent).toBe("2 yes");
      expect(details.querySelector("summary svg")).not.toBeNull();
      const links = within(details as HTMLElement).getAllByRole("link");
      expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
        [shortHash(UNKNOWN_ID), `/xrpl/amendments/${UNKNOWN_ID}`],
        ["XChainBridge", "/xrpl/amendments/XChainBridge"],
      ]);
      expect(links.every((link) => link.classList.contains("mono"))).toBe(true);
    });

    it("opens by the visitor's hand and stays open through a beat", () => {
      const first = build();
      let update!: (next: ValidatorsPageData) => void;
      function Host() {
        const [current, setCurrent] = useState(first);
        update = (next) => act(() => setCurrent(next));
        return <ValidatorsPage data={loaded(current)} live={controls()} />;
      }
      render(routed(<Host />));
      const details = () => cellsOf(rowOf("northpeak.example"))[4]!.querySelector("details")!;
      act(() => {
        details().open = true;
      });
      update(build({ summary: ok(summary({ updated: "2026-10-19T15:55:00Z" })) }));
      expect(details().open).toBe(true);
    });

    it("says '0 yes' as plain text, with no disclosure, for a validator that votes for nothing", () => {
      mount(build({ params: { scope: "all" } }));
      const cell = cellsOf(rowOf("tidewater.example"))[4]!;
      expect(text(cell)).toBe("0 yes");
      expect(cell.querySelector("details")).toBeNull();
    });

    it("says '0 yes' for a validator with no record of votes at all", () => {
      mount(build());
      expect(text(cellsOf(rowOf(shortHash(KEY_QUIET)))[4]!)).toBe("0 yes");
    });
  });

  describe("last seen", () => {
    it("prints the absolute time in the stored HTML, and no age", () => {
      const html = htmlOf(build());
      expect(html).toContain("2026-10-19 15:53:40 UTC");
      expect(html).not.toMatch(/\b(min|s) ago\b/);
    });

    it("is an age no finer than a minute: '< 1 min ago' under it, then the age", () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(NOW * 1000);
      mount(build());
      expect(text(cellsOf(rowOf("northpeak.example"))[5]!)).toBe("< 1 min ago");
      expect(text(cellsOf(rowOf("shoreline.example"))[5]!)).toBe("9 min ago");
      act(() => {
        vi.setSystemTime((NOW + 70) * 1000);
        vi.advanceTimersByTime(1000);
      });
      expect(text(cellsOf(rowOf("northpeak.example"))[5]!)).toBe("2 min ago");
    });

    it("has the absolute time on hover, in the element, and is right-aligned", () => {
      mount(build());
      const cell = cellsOf(rowOf("northpeak.example"))[5]!;
      expect(cell.classList.contains("is-end")).toBe(true);
      const time = cell.querySelector("time")!;
      expect(time.getAttribute("title")).toBe("2026-10-19 15:53:40 UTC");
      expect(time.getAttribute("datetime")).toBe("2026-10-19T15:53:40.000Z");
    });

    it("says 'not seen' for a validator the data API never heard", () => {
      mount(build({ params: { scope: "all" } }));
      expect(text(cellsOf(rowOf("tidewater.example"))[5]!)).toBe("not seen");
      expect(text(cellsOf(rowOf(shortHash(KEY_QUIET)))[5]!)).toBe("not seen");
    });
  });
});

describe("ValidatorsPage, the footer and the empty states", () => {
  it("has the builder's footer, in one line, parts apart by a dot", () => {
    const data = build();
    mount(data);
    const footer = card("Validators").querySelector(".validators__foot")!;
    expect(text(footer)).toBe((data.list.state === "ok" ? data.list.footer : []).join(" · "));
    expect(text(footer)).toBe("3 validators · in the order of their domain, then their key · Fee votes in XRP / XRP / drops; ↑ ↓ against the current value");
  });

  it("says 'matches' for a filtered view, and adds the note of a list that was cut", () => {
    mount(build({ params: { scope: "unl", q: "peak" }, list: ok(listOf(fleet(), "MARKER")) }));
    expect(text(card("Validators").querySelector(".validators__foot")!)).toBe(
      "1 match · in the order of their domain, then their key · Fee votes in XRP / XRP / drops; ↑ ↓ against the current value · The first 1,000 validators in this order are shown.",
    );
  });

  it("says what the fee arrows lack when the summary did not load", () => {
    mount(build({ summary: FAILED }));
    expect(text(card("Validators").querySelector(".validators__foot")!)).toContain("Fee votes are not compared with the current fees: they could not be loaded");
  });

  it("says 'No validators match these filters.' with a Clear filters link when a filter leaves nothing", () => {
    mount(build({ params: { scope: "all", q: "no such validator" } }));
    const empty = card("Validators").querySelector(".table__empty")!;
    expect(empty.firstChild!.textContent).toContain("No validators match these filters.");
    expect(within(empty as HTMLElement).getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe("/xrpl/validators?scope=all");
    expect(within(table()).queryAllByRole("row")).toHaveLength(1);
  });

  it("says 'No validators to show yet.' with no Clear link when nothing is set and the list is empty", () => {
    mount(build({ list: ok(listOf([])) }));
    const empty = card("Validators").querySelector(".table__empty")!;
    expect(text(empty)).toBe("No validators to show yet.");
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
  });

  it("shows a section error with Retry in place of the table when the list did not load, and keeps the filters and the chips", () => {
    mount(build({ list: FAILED }));
    const validators = card("Validators");
    expect(within(validators).queryByRole("table")).toBeNull();
    expect(text(within(validators).getByRole("alert"))).toBe("Couldn’t load the validators.Retry");
    expect(within(validators).getByRole("search", { name: "Filter validators" })).toBeTruthy();
    expect(within(validators).getByRole("group", { name: "Which validators" })).toBeTruthy();
    expect(validators.querySelector(".validators__foot")).toBeNull();
  });

  it("has the source line under the card's title", () => {
    mount(build());
    expect(card("Validators").querySelector(".chart__source")!.textContent).toBe("/v2/network/validators");
  });
});

describe("ValidatorsPage, Retry", () => {
  it("asks the route's loader again, from the explorer's own Worker, whatever failed", async () => {
    const loader = vi.fn(() => null);
    mount(build({ list: FAILED }), { loader });
    const calls = loader.mock.calls.length;
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    await act(async () => {});
    expect(loader.mock.calls.length).toBe(calls + 1);
  });

  it("is on each error that is shown: the overview's and the versions card's, too", () => {
    mount(build({ summary: FAILED }));
    const retries = screen.getAllByRole("button", { name: "Retry" });
    expect(retries).toHaveLength(2);
  });

  it("disables the buttons only while the revalidation that a press started runs", async () => {
    let release!: () => void;
    let held: Promise<null> | null = null;
    mount(build({ list: FAILED }), { loader: () => held as never });
    held = new Promise<null>((resolve) => (release = () => resolve(null)));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {});
    expect((screen.getByRole("button", { name: "Retrying…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
    expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ValidatorsPage, the failures of the three calls", () => {
  it("draws what loaded when the amendments did not: the tiles, the versions and the list stand", () => {
    mount(build({ amendments: FAILED }));
    expect(tile("Quorum").value).toBe("28 of 35");
    expect(within(table()).getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws the list when the summary did not load: no tiles, no versions, no 'Listed by', and the table", () => {
    mount(build({ summary: FAILED }));
    expect(within(table()).getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByLabelText("Listed by")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });
});

// ---- Holding the page -------------------------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, the table's hold", () => {
  const scroll = () => region("Validators, scrollable table");
  const holds = (live: LiveControls) => (live.onHold as ReturnType<typeof vi.fn>).mock.calls.map(([held]) => held);

  it("holds while a mouse is over the table, and lets go when it leaves", () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.pointerEnter(scroll(), { pointerType: "mouse" });
    fireEvent.pointerLeave(scroll(), { pointerType: "mouse" });
    expect(holds(live)).toEqual([true, false]);
  });

  it("is not for a finger", () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.pointerEnter(scroll(), { pointerType: "touch" });
    expect(holds(live)).toEqual([]);
  });

  it("holds while keyboard focus is on a link or a disclosure in the table, and lets go when it leaves it", () => {
    const live = controls();
    mount(build(), { live });
    act(() => within(scroll()).getAllByRole("link")[0]!.focus());
    expect(holds(live).at(-1)).toBe(true);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(holds(live).at(-1)).toBe(false);
    act(() => scroll().querySelector("summary")!.focus());
    expect(holds(live).at(-1)).toBe(true);
  });

  it("does not hold for the charts, the filters or the tiles", () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.pointerEnter(card("Validator software versions"), { pointerType: "mouse" });
    fireEvent.pointerEnter(region("Network overview"), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByRole("search", { name: "Filter validators" }), { pointerType: "mouse" });
    expect(holds(live)).toEqual([]);
  });

  it("lets go when the page goes away, whatever was held", () => {
    const live = controls();
    const { unmount } = mount(build(), { live });
    fireEvent.pointerEnter(scroll(), { pointerType: "mouse" });
    expect(holds(live).at(-1)).toBe(true);
    unmount();
    expect(holds(live).at(-1)).toBe(false);
  });

  it("does not hold for the versions card's own table either: a chart's view, and charts do not hold", () => {
    const live = controls();
    mount(build(), { live });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "Validator software versions, scrollable table" }), { pointerType: "mouse" });
    expect(holds(live)).toEqual([]);
  });
});

// ---- The page follows the chain -----------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, when its data changes", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  });

  let update!: (next: ValidatorsPageData) => void;
  function Host({ first }: { first: ValidatorsPageData }) {
    const [current, setCurrent] = useState(first);
    update = (next) => act(() => setCurrent(next));
    return <ValidatorsPage data={loaded(current)} live={controls()} />;
  }
  const mountHost = (first = build()) => render(routed(<Host first={first} />));

  it("animates nothing on the first render, on the server or in the browser", () => {
    const { container } = mountHost();
    expect(container.querySelector(".is-entering, .is-changed")).toBeNull();
    expect(htmlOf(build())).not.toMatch(/is-entering|is-changed/);
  });

  it("ticks in only the tile whose figure changed", () => {
    const { container } = mountHost();
    update(build({ summary: ok(summary({ quorum: { value: 29, unl_size: 36, negative_unl: 1, node: 29 } })) }));
    expect(tile("Quorum").element.querySelector(".stat__value .is-changed")!.textContent).toBe("29 of 36");
    expect(tile("Validators seen, last 24 h").element.querySelector(".is-changed")).toBeNull();
    expect(tile("Next flag ledger").element.querySelector(".is-changed")).toBeNull();
    expect(container.querySelectorAll(".stat .is-changed")).toHaveLength(1);
  });

  it("ticks in a note that says something else, with its text as the token", () => {
    mountHost();
    update(build({ summary: ok(summary({ validators: { seen_24h: 55, unl_seen_24h: 34, others_seen_24h: 21, all: 56 } })) }));
    expect(tile("Validators seen, last 24 h").element.querySelectorAll(".is-changed")).toHaveLength(2);
    expect(tile("On the default UNL").element.querySelector(".is-changed")).toBeNull();
  });

  it("brings a new validator in as an entering row and leaves the others", () => {
    const { container } = mountHost(build({ params: { scope: "all" } }));
    const more = [...fleet(), validatorRowSample({ validation_public_key: SAMPLE_KEYS[6], domain: "zenith.example", signing_key: SAMPLE_SIGNING_KEYS[0], last_seen: seen(5) })];
    update(build({ params: { scope: "all" }, list: ok(listOf(more)) }));
    expect(Array.from(container.querySelectorAll(".is-entering"), (row) => row.getAttribute("data-key"))).toEqual([SAMPLE_KEYS[6]]);
  });

  it("rings the share bar when the versions changed, and not when they did not", () => {
    const { container } = mountHost();
    update(build());
    expect(container.querySelector(".share.is-changed")).toBeNull();
    update(build({ summary: ok(summary({ versions: [{ version: "3.5.0", unl: 2, all: 5 }, ...summary().versions] })) }));
    expect(container.querySelectorAll(".share.is-changed")).toHaveLength(1);
  });
});

describe("ValidatorsPage, refetching", () => {
  it("dims its charts while another view is loading, and not while it only follows the chain", async () => {
    let release!: () => void;
    let held: Promise<null> | null = null;
    const router = createMemoryRouter([{ path: "*", element: <ValidatorsPage data={loaded(build())} live={controls()} />, loader: () => held }], {
      initialEntries: ["/xrpl/validators"],
      hydrationData: { loaderData: { "0": null } },
    });
    const { container } = render(<RouterProvider router={router} />);
    const root = () => container.querySelector(".validators")!;
    expect(root().classList.contains("is-refetching")).toBe(false);

    held = new Promise<null>((resolve) => (release = () => resolve(null)));
    await act(async () => void router.revalidate());
    expect(root().classList.contains("is-refetching")).toBe(false);
    await act(async () => release());

    held = new Promise<null>((resolve) => (release = () => resolve(null)));
    await act(async () => void router.navigate("/xrpl/validators?scope=all"));
    expect(root().classList.contains("is-refetching")).toBe(true);
    await act(async () => release());
    expect(root().classList.contains("is-refetching")).toBe(false);
  });
});

// ---- Filling states (spec 10) -----------------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, while the data API fills", () => {
  it("shows a list with no fee votes, an incomplete agreement and domains not checked yet as the quiet words they are", () => {
    const filling = fleet().map((row) => ({
      ...without(row, "fee_vote"),
      domain_verification: row.domain === undefined ? undefined : { status: "pending" as const, toml_url: `https://${row.domain}/.well-known/xrp-ledger.toml` },
      agreement_24h: { ...row.agreement_24h, incomplete: true },
    }));
    mount(build({ params: { scope: "all" }, list: ok(listOf(filling as ValidatorRow[])) }));
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => text(cellsOf(row)[3]!))).toEqual(Array(5).fill("—no fee vote recorded"));
    expect(rows.every((row) => text(cellsOf(row)[2]!).endsWith("incomplete"))).toBe(true);
    expect(within(table()).getAllByText("not checked yet")).toHaveLength(3);
    expect(screen.queryByText("not verified")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ---- The stored HTML ----------------------------------------------------------------------------------------------------------------------

describe("ValidatorsPage, as the Worker prints it and the browser takes it over", () => {
  it("hydrates without a mismatch, in the stored HTML's words", async () => {
    const { html, container, errors } = await serverThenHydrated(routed(<ValidatorsPage data={loaded(build())} live={controls()} />));
    expect(errors).toEqual([]);
    expect(html).toContain("2026-10-19 15:53:40 UTC");
    expect(container.querySelectorAll('[aria-label="Validators"] [role="row"]')).toHaveLength(4);
  });

  it("holds the whole page in the HTML: the tiles, both views of the versions, the filters and every row", () => {
    const html = htmlOf(build({ params: { scope: "all" } }));
    for (const part of ["Network overview", "Validator software versions", "Filter validators", "tidewater.example", "shoreline.example", "northpeak.example", "no domain"]) {
      expect(html).toContain(part);
    }
    expect(html).not.toMatch(/\bago\b/);
    expect(html).not.toMatch(/in ~\d+ min/);
  });

  it("hydrates the failed states too", async () => {
    const { errors } = await serverThenHydrated(routed(<ValidatorsPage data={loaded(build({ summary: FAILED, list: FAILED, amendments: FAILED }))} live={controls()} />));
    expect(errors).toEqual([]);
  });
});
