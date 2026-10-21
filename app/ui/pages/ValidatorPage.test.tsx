import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { amendmentsSample, SAMPLE_KEYS, SAMPLE_SIGNING_KEYS, summarySample, UNKNOWN_ID, validationsSample, validatorDetailSample } from "../../../test/support/d1-samples";
import { serverThenHydrated } from "../../../test/support/hydrate";
import { shortHash } from "../../domain/format";
import type { Loaded } from "../../server/account-view";
import type { Anchor } from "../../server/anchor";
import type { ValidatorDetail, ValidatorValidationsPage } from "../../server/api-types";
import { validatorHistoryPage, validatorPage, type ValidatorHistoryData, type ValidatorLiveData } from "../../server/validator-view";
import type { NetworkInfo } from "../networks";
import type { LiveControls } from "../use-live-controls";
import { ValidatorHistoryPage, ValidatorPage } from "./ValidatorPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", name: "XRPL", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", name: "Xahau", native: "XAH", software: "xahaud" };

const ok = <T,>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED: Loaded<never> = { state: "failed" };

/** A copy of an object without some of its keys (D1 leaves a key out; it never sends `null`). */
function without<T extends object, K extends keyof T>(object: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

const KEY = SAMPLE_KEYS[0];
const unix = (iso: string) => Date.parse(iso) / 1000;
/** The chain's newest ledger: 2026-10-19 16:26:23 UTC, three seconds after the newest validation of the sample (16:26:20.250). */
const ANCHOR: Anchor = { lastValidated: 107748183, closeTime: unix("2026-10-19T16:26:23Z") };

type Input = Parameters<typeof validatorPage>[0];
/** `northpeak.example` as the builder makes it from the samples: every part loaded, unless `over` says otherwise. */
function build(over: Partial<Input> = {}): ValidatorLiveData {
  return validatorPage({
    network: XRPL,
    validator: validatorDetailSample(),
    recent: ok(validationsSample()),
    summary: ok(summarySample()),
    amendments: ok(amendmentsSample()),
    anchor: ANCHOR,
    ...over,
  });
}

/** What the route hands the page: the builder's data, the anchor the loader read and the build. */
const loaded = (data: ValidatorLiveData) => ({ ...data, anchor: ANCHOR, build: "test-build" });

const controls = (over: Partial<LiveControls> = {}): LiveControls => ({
  paused: false,
  held: false,
  notice: "",
  failures: 0,
  onTogglePause: vi.fn(),
  onHold: vi.fn(),
  ...over,
});

/** The page in a data router, drawn at once (its route's data is given, as the document gives it). The `loader` is what a Retry runs again. */
function mount(ui: ReactElement, loader: () => null = () => null) {
  const router = createMemoryRouter([{ path: "*", element: ui, loader }], { initialEntries: [`/xrpl/validators/${KEY}`], hydrationData: { loaderData: { "0": null } } });
  return { router, ...render(<RouterProvider router={router} />) };
}
const mountPage = (data: ValidatorLiveData, live = controls(), loader?: () => null) => mount(<ValidatorPage data={loaded(data)} live={live} />, loader);
const mountHistory = (data: ValidatorHistoryData) => mount(<ValidatorHistoryPage data={data} />);

const routed = (ui: ReactElement) => <RouterProvider router={createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [`/xrpl/validators/${KEY}`] })} />;

const identity = () => screen.getByRole("region", { name: "Validator" });
const card = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;
const table = (name: string) => screen.getByRole("table", { name });
/** The rows of a table as their cells' texts, header row left out. */
const rowsOf = (name: string) =>
  within(table(name))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
/** A fact of the identity's grid: what its value and the line under it say. */
function fact(label: string) {
  const element = within(identity()).getByText(label, { selector: ".validator__label" }).closest(".validator__fact")!;
  return { element, value: element.querySelector(".validator__value")!.textContent, sub: element.querySelector(".validator__sub")?.textContent ?? null };
}
/** A tile of the agreement section. */
function tile(label: string) {
  const element = within(screen.getByRole("region", { name: "Agreement" })).getByText(label).closest(".stat")!;
  return { element, value: element.querySelector(".stat__value")!.textContent, sub: element.querySelector(".stat__sub")?.textContent ?? null };
}

// ---- The heading and the live row ----------------------------------------------------------------------------------------------------------

describe("ValidatorPage, the heading", () => {
  it("has the breadcrumb XRPL / Network / Validators / the domain, each but the last a link", () => {
    mountPage(build());
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["XRPL/", "Network/", "Validators/", "northpeak.example"]);
    expect(crumbs.getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/xrpl/network");
    expect(crumbs.getByRole("link", { name: "Validators" }).getAttribute("href")).toBe("/xrpl/validators");
    expect(crumbs.getByText("northpeak.example").getAttribute("aria-current")).toBe("page");
  });

  it("names a validator with no domain by its short master key, in mono, in the breadcrumb and the h1", () => {
    mountPage(build({ validator: without(validatorDetailSample(), "domain", "domain_verification") }));
    const last = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText(shortHash(KEY));
    expect(last.classList.contains("mono")).toBe(true);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe(shortHash(KEY));
    expect(h1.classList.contains("mono")).toBe(true);
    // No domain: no status, and no note under the name.
    expect(within(identity()).queryByText(/verified|checked/)).toBeNull();
    expect(identity().querySelector(".validator__note")).toBeNull();
  });

  it("has the live row with 'Live · updates every ledger', the one h1 being the validator's", () => {
    const { container } = mountPage(build());
    expect(container.querySelector(".hero__status-row .hero__status")!.textContent).toBe("Live · updates every ledger");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["northpeak.example"]);
  });

  it("says 'Paused while you look at the table' while held, and has the pause button", async () => {
    const live = controls({ held: true });
    const { container } = mountPage(build(), live);
    expect(container.querySelector(".hero__held")!.textContent).toBe("Paused while you look at the table");
    fireEvent.click(await screen.findByRole("button", { name: "Pause live updates" }));
    expect(live.onTogglePause).toHaveBeenCalledTimes(1);
  });
});

// ---- The identity --------------------------------------------------------------------------------------------------------------------------

describe("ValidatorPage, the identity", () => {
  it("is a section named Validator: 'Validator' over the h1, the domain's status, the UNL tag with its publishers as hidden words, and the source line", () => {
    mountPage(build());
    const section = identity();
    expect(section.querySelector(".validator__kind")!.textContent).toBe("Validator");
    expect(within(section).getByRole("heading", { level: 1 }).textContent).toBe("northpeak.example");
    const verified = within(section).getByText("Domain verified");
    expect(verified.classList.contains("st--ok")).toBe(true);
    expect(verified.querySelector("svg")).toBeTruthy();
    const unl = within(section).getByText("UNL", { selector: ".tag" });
    expect(unl.querySelector(".sr")!.textContent).toBe(" Listed by unl.xrplf.org and vl.ripple.com");
    expect(unl.getAttribute("title")).toBe("Listed by unl.xrplf.org and vl.ripple.com");
    expect(within(section).queryByText("Negative UNL")).toBeNull();
    expect(within(section).getByText("/v2/network/validators/{key}")).toBeTruthy();
  });

  it("links the verified domain's TOML file in its note, to another site, with the time it was checked", () => {
    mountPage(build());
    const note = identity().querySelector(".validator__note")!;
    expect(note.textContent).toBe("The xrp-ledger.toml (opens in a new tab) at northpeak.example lists this master key. Checked Oct 19, 2026, 19:15 UTC.");
    const link = within(note as HTMLElement).getByRole("link", { name: "xrp-ledger.toml (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://northpeak.example/.well-known/xrp-ledger.toml");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("says 'not verified' with the reason, and links nothing of an unverified domain", () => {
    const verification = { status: "unverified", reason: "not_listed", toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml", checked: "2026-10-19T15:00:00Z" } as const;
    mountPage(build({ validator: validatorDetailSample({ domain_verification: verification }) }));
    const status = within(identity()).getByText("not verified");
    expect(status.classList.contains("st--quiet")).toBe(true);
    expect(identity().querySelector(".validator__note")!.textContent).toBe("The xrp-ledger.toml at northpeak.example does not list this master key.");
    expect(within(identity().querySelector(".validator__note") as HTMLElement).queryByRole("link")).toBeNull();
    // The accounts of a domain that did not verify are not drawn.
    expect(within(identity()).queryByText("Accounts northpeak.example lists")).toBeNull();
  });

  it("says 'not checked yet' for a domain the data API has not checked, with its note", () => {
    mountPage(build({ validator: validatorDetailSample({ domain_verification: { status: "pending", toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml" } }) }));
    expect(within(identity()).getByText("not checked yet").classList.contains("st--quiet")).toBe(true);
    expect(identity().querySelector(".validator__note")!.textContent).toBe("The domain has not been checked yet.");
  });

  it("has the Negative UNL tag, and the ledger it went on it at from the summary", () => {
    mountPage(build({ validator: validatorDetailSample({ validation_public_key: SAMPLE_KEYS[5], negative_unl: true }) }));
    expect(within(identity()).getByText("Negative UNL", { selector: ".tag" })).toBeTruthy();
    const membership = fact("UNL membership");
    expect(membership.sub).toBe("On the negative UNL since ledger #107,747,000");
    expect(within(membership.element as HTMLElement).getByRole("link", { name: "#107,747,000" }).getAttribute("href")).toBe("/xrpl/ledger/107747000");
  });

  it("writes the master key in full with its copy button, and the signing key short with the full key as its title and its own copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    mountPage(build());
    expect(within(identity()).getByText(KEY, { exact: false }).textContent).toBe(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Copy master public key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY));

    const signing = fact("Current signing key");
    expect(signing.value).toBe(shortHash(SAMPLE_SIGNING_KEYS[0]));
    expect(within(signing.element as HTMLElement).getByText(shortHash(SAMPLE_SIGNING_KEYS[0])).getAttribute("title")).toBe(SAMPLE_SIGNING_KEYS[0]);
    fireEvent.click(screen.getByRole("button", { name: "Copy signing key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SAMPLE_SIGNING_KEYS[0]));
  });

  it("has the facts of the board's grid: the manifest, the version, first seen and the accounts the domain lists", () => {
    mountPage(build());
    expect(fact("Manifest sequence")).toMatchObject({ value: "2", sub: "2 signing keys seen by the data API" });
    const version = fact("Version");
    expect(version.value).toBe("3.4.1latest");
    expect(within(version.element as HTMLElement).getByText("latest").classList.contains("st--ok")).toBe(true);
    expect(fact("First seen").value).toBe("Jul 21, 2026 · first seen by the data API");
    const accounts = fact("Accounts northpeak.example lists");
    const link = within(accounts.element as HTMLElement).getByRole("link");
    expect(link.getAttribute("href")).toBe("/xrpl/account/rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
    expect(link.getAttribute("title")).toBe("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
  });

  it("says 'one signing key seen', and dashes for what D left out", () => {
    const bare = without(validatorDetailSample(), "signing_key", "version", "version_latest", "first_seen");
    mountPage(build({ validator: { ...bare, manifest: { sequence: 1, signing_key: SAMPLE_SIGNING_KEYS[0], signing_keys_seen: 1 } } as ValidatorDetail }));
    expect(fact("Manifest sequence")).toMatchObject({ value: "1", sub: "one signing key seen" });
    expect(fact("Current signing key").value).toBe("—");
    expect(fact("Version").value).toBe("—");
    expect(fact("First seen").value).toBe("—");
    expect(screen.queryByRole("button", { name: "Copy signing key" })).toBeNull();
  });

  it("is Xahau's on Xahau: the build number after the version, and the xahau.toml", () => {
    const validator = validatorDetailSample({
      version: "2026.10.13",
      version_build: 4119,
      version_latest: false,
      domain_verification: { status: "verified", toml_url: "https://northpeak.example/.well-known/xahau.toml" },
    });
    mountPage(build({ network: XAHAU, validator }));
    expect(fact("Version").value).toBe("2026.10.13 · build 4119");
    expect(within(identity()).getByRole("link", { name: "xahau.toml (opens in a new tab)" })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Xahau" }).getAttribute("href")).toBe("/xahau");
  });
});

describe("ValidatorPage, UNL membership", () => {
  const lines = () => [...fact("UNL membership").element.querySelectorAll(".validator__member")].map((line) => line.textContent);

  it("lists every publisher of the summary, with a check and 'listed' or a dash and 'not listed'", () => {
    mountPage(build({ validator: validatorDetailSample({ unl_lists: ["vl.ripple.com"] }) }));
    expect(lines()).toEqual(["unl.xrplf.orgnot listed", "vl.ripple.comlisted"]);
    const [off, on] = [...fact("UNL membership").element.querySelectorAll(".validator__member .st")];
    expect(on!.classList.contains("st--ok")).toBe(true);
    expect(on!.querySelector("svg")).toBeTruthy();
    expect(off!.classList.contains("st--quiet")).toBe(true);
    expect(off!.querySelector("svg")).toBeTruthy();
  });

  it("lists the publishers D names as listed when the summary did not load, and has no negative UNL ledger", () => {
    mountPage(build({ summary: FAILED, validator: validatorDetailSample({ validation_public_key: SAMPLE_KEYS[5], negative_unl: true }) }));
    expect(lines()).toEqual(["unl.xrplf.orglisted", "vl.ripple.comlisted"]);
    expect(fact("UNL membership").sub).toBeNull();
  });

  it("says 'On no default list' when no list names it and the summary did not load", () => {
    mountPage(build({ summary: FAILED, validator: validatorDetailSample({ unl: false, unl_lists: [] }) }));
    expect(fact("UNL membership").value).toBe("On no default list");
  });
});

// ---- Last seen -----------------------------------------------------------------------------------------------------------------------------

describe("ValidatorPage, last seen", () => {
  it("is precise from the newest recent validation, with its ledger", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-19T16:26:23.400Z"));
    mountPage(build());
    const seen = fact("Last seen");
    expect(seen.value).toBe("3 s ago");
    expect(seen.sub).toBe("last validation, ledger #107,748,007");
    expect(within(seen.element as HTMLElement).getByRole("link", { name: "#107,748,007" }).getAttribute("href")).toBe("/xrpl/ledger/107748007");
  });

  it("is D's, no finer than a minute, when the recent validations did not load", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // D's last seen is 19:24:52.750; 30 s later.
    vi.setSystemTime(Date.parse("2026-10-19T19:25:23Z"));
    mountPage(build({ recent: FAILED }));
    expect(fact("Last seen")).toMatchObject({ value: "< 1 min ago", sub: "last validation, ledger #107,748,183" });
  });

  it("is D's too when the recent validations loaded with no row", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-19T19:25:23Z"));
    mountPage(build({ recent: ok(validationsSample({ validations: [], count: 0 })) }));
    expect(fact("Last seen")).toMatchObject({ value: "< 1 min ago", sub: "last validation, ledger #107,748,183" });
  });

  it("says the data API has not seen one it never saw", () => {
    mountPage(build({ recent: FAILED, validator: without(validatorDetailSample(), "last_seen", "current_index") as ValidatorDetail }));
    expect(fact("Last seen")).toMatchObject({ value: "not seen by the data API", sub: null });
  });
});

// ---- Agreement -----------------------------------------------------------------------------------------------------------------------------

describe("ValidatorPage, agreement", () => {
  it("has the three tiles of the board in a section named Agreement, with 'incomplete' under a window that misses hours", () => {
    mountPage(build());
    expect(tile("Agreement, 1 h")).toMatchObject({ value: "99.89%", sub: "1 missed of 900 validated ledgers · 1 partial" });
    expect(tile("Agreement, 24 h")).toMatchObject({ value: "99.99%", sub: "2 missed of 21,600 validated ledgers · 1 partial" });
    const month = tile("Agreement, 30 days");
    expect(month.value).toBe("99.99%");
    expect(month.sub).toBe("3 missed of 43,200 validated ledgers · 2 partial incomplete");
    expect(within(month.element as HTMLElement).getByText("incomplete").classList.contains("st--quiet")).toBe(true);
    expect(tile("Agreement, 1 h").element.textContent).not.toContain("incomplete");
  });

  it("shows a dash and why on a tile with no score", () => {
    const empty = { missed: 0, total: 0, incomplete: false, partial: 0 };
    mountPage(build({ validator: validatorDetailSample({ agreement_1h: empty, agreement_24h: empty, agreement_30d: empty }) }));
    for (const label of ["Agreement, 1 h", "Agreement, 24 h", "Agreement, 30 days"]) expect(tile(label), label).toMatchObject({ value: "—", sub: "No validated ledgers counted yet" });
  });

  it("draws the 30 days as a chart card that names its lowest day, with its own table newest first and the notes", () => {
    mountPage(build());
    const daily = card("Daily agreement with validated ledgers, last 30 days");
    expect(within(daily).getByText("/v2/network/validators/{key}")).toBeTruthy();
    expect(within(daily).getByRole("img", { name: /Lowest Oct 19, so far, 99\.99%/ })).toBeTruthy();
    expect(within(daily).getByRole("radio", { name: "Table" })).toBeTruthy();
    expect(within(table("Daily agreement")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day (UTC)",
      "Agreement",
      "Validated ledgers",
      "Missed",
      "Partial",
      "Complete",
    ]);
    expect(rowsOf("Daily agreement")).toEqual([
      ["Oct 19", "99.99%", "17,100", "2", "1", "no, hours missing"],
      ["Oct 18", "100.00%", "21,600", "1", "1", "yes"],
      ["Oct 17", "100.00%", "4,500", "0", "0", "no, hours missing"],
      ["Sep 20", "—", "0", "0", "0", "no, hours missing"],
    ]);
    expect([...daily.querySelectorAll(".chart__notes p")].map((p) => p.textContent)).toEqual([
      "Share of the validated ledgers this validator signed with the same hash. Partial validations do not count toward agreement.",
      "Incomplete days are missing some hours of the data API's record.",
      "The axis starts at 99%.",
    ]);
  });

  it("says no day is recorded yet in place of an empty plot", () => {
    mountPage(build({ validator: validatorDetailSample({ daily_agreement: [] }) }));
    const daily = card("Daily agreement with validated ledgers, last 30 days");
    expect(daily.textContent).toContain("No daily agreement recorded yet.");
    expect(within(daily).queryByRole("img")).toBeNull();
    expect(within(daily).queryByRole("table")).toBeNull();
    expect(within(daily).queryByRole("radio")).toBeNull();
  });
});

// ---- Fee votes -----------------------------------------------------------------------------------------------------------------------------

describe("ValidatorPage, fee votes", () => {
  const note = () => card("Fee votes").querySelector(".validator__foot")!.textContent;

  it("has the board's table: its vote, the fees now and the pill of each against now, and the note with the voting ledger", () => {
    mountPage(build({ validator: validatorDetailSample({ fee_vote: { ledger_index: 107748095, base_fee: "0.000012", reserve_base: "0.8", reserve_inc: "0.2" } }) }));
    expect(within(table("Fee votes")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Setting", "Its vote", "Now", "Against now"]);
    expect(rowsOf("Fee votes")).toEqual([
      ["Base reserve", "0.8 XRP", "1 XRP", "Lower"],
      ["Owner reserve", "0.2 XRP", "0.2 XRP", "Same"],
      ["Base fee", "12 drops", "10 drops", "Higher"],
    ]);
    for (const pill of within(table("Fee votes")).getAllByText(/^(Lower|Same|Higher)$/)) {
      expect(pill.classList.contains("pill--neutral")).toBe(true);
      expect(pill.querySelector("svg")).toBeTruthy();
    }
    expect(note()).toBe("Fee votes are counted on flag ledgers, every 256 ledgers. Its vote is from voting ledger #107,748,095.");
    expect(within(card("Fee votes")).getByRole("link", { name: "#107,748,095" }).getAttribute("href")).toBe("/xrpl/ledger/107748095");
  });

  it("says no fee vote is recorded when D has none", () => {
    mountPage(build({ validator: without(validatorDetailSample(), "fee_vote") as ValidatorDetail }));
    expect(card("Fee votes").textContent).toContain("No fee vote recorded in the last 24 hours.");
    expect(within(card("Fee votes")).queryByRole("table")).toBeNull();
    expect(note()).toBe("Fee votes are counted on flag ledgers, every 256 ledgers.");
  });

  it("has no Now and no Against now when the summary did not load, and says why", () => {
    mountPage(build({ summary: FAILED }));
    expect(rowsOf("Fee votes")).toEqual([
      ["Base reserve", "1 XRP", "—", "—"],
      ["Owner reserve", "0.2 XRP", "—", "—"],
      ["Base fee", "10 drops", "—", "—"],
    ]);
    expect(note()).toBe("Fee votes are counted on flag ledgers, every 256 ledgers. Its vote is from voting ledger #107,748,095. Fee votes are not compared with the current fees: they could not be loaded.");
  });

  it("says the current fees are not known yet when the summary has none", () => {
    mountPage(build({ summary: ok(without(summarySample(), "fees")) }));
    expect(rowsOf("Fee votes").map((row) => row.slice(2))).toEqual([
      ["—", "—"],
      ["—", "—"],
      ["—", "—"],
    ]);
    expect(note()).toBe("Fee votes are counted on flag ledgers, every 256 ledgers. Its vote is from voting ledger #107,748,095. Fee votes are not compared with the current fees: they are not known yet.");
  });

  it("counts on flag ledgers without the interval when the amendments did not load", () => {
    mountPage(build({ amendments: FAILED }));
    expect(note()).toBe("Fee votes are counted on flag ledgers. Its vote is from voting ledger #107,748,095.");
  });
});

// ---- Amendment votes -----------------------------------------------------------------------------------------------------------------------

describe("ValidatorPage, amendment votes", () => {
  /** The pill of each row's Status cell: every status is an icon and a word (spec 2.5), with or without A. */
  const statusPills = () =>
    within(table("Amendment votes"))
      .getAllByRole("row")
      .slice(1)
      .map((row) => {
        const pill = within(row).getAllByRole("cell")[1]!.querySelector(".pill");
        expect(pill, row.textContent!).toBeTruthy();
        expect(pill!.querySelector("svg"), row.textContent!).toBeTruthy();
        return { text: pill!.textContent, tone: Array.from(pill!.classList).find((name) => name.startsWith("pill--")) };
      });

  it("lists D's votes in D's order, each a link, with A's status and the vote's pill, and the link to every amendment", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-19T16:26:23Z"));
    mountPage(build());
    const votes = card("Amendment votes");
    expect(within(table("Amendment votes")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Amendment", "Status", "Its vote"]);
    expect(rowsOf("Amendment votes")).toEqual([
      // A's majority, counting down to its activation (the stored page has its day: see below).
      ["XChainBridge", "Activating, in 12 days", "Yes"],
      // D says voting; A, which is newer, says nobody has named it.
      [shortHash(UNKNOWN_ID), "Unknown", "Yes"],
      ["DID", "Voting · 11.4% yes", "No"],
      // A has no row of it: D's word.
      [shortHash("2".repeat(64)), "Unknown", "No"],
    ]);
    expect(within(table("Amendment votes")).getByRole("link", { name: "XChainBridge" }).getAttribute("href")).toBe("/xrpl/amendments/XChainBridge");
    expect(within(table("Amendment votes")).getByRole("link", { name: shortHash(UNKNOWN_ID) }).getAttribute("href")).toBe(`/xrpl/amendments/${UNKNOWN_ID}`);
    expect(within(table("Amendment votes")).getByRole("link", { name: shortHash(UNKNOWN_ID) }).classList.contains("mono")).toBe(true);
    // Each a pill with its icon: the accent wash and the clock, the outlined question, the neutral ballot with the share of yes.
    expect(statusPills()).toEqual([
      { text: "Activating, in 12 days", tone: "pill--info" },
      { text: "Unknown", tone: "pill--off" },
      { text: "Voting · 11.4% yes", tone: "pill--neutral" },
      { text: "Unknown", tone: "pill--off" },
    ]);
    expect(within(votes).getByRole("link", { name: "All amendments →" }).getAttribute("href")).toBe("/xrpl/amendments");
    expect(votes.querySelector(".validator__foot")!.textContent).toBe(
      "Amendments still being voted on. A validator that does not vote yes counts as no. Its votes of voting ledger #107,748,095.",
    );
  });

  it("draws Yes, No and No recent vote as pills with their words", () => {
    const votes = validatorDetailSample().amendment_votes;
    mountPage(build({ validator: validatorDetailSample({ amendment_votes: { ...votes, votes: votes.votes.map((vote, i) => ({ ...vote, vote: (["yes", "no", "none", "no"] as const)[i]! })) } }) }));
    expect(within(table("Amendment votes")).getByText("Yes").classList.contains("pill--ok")).toBe(true);
    expect(within(table("Amendment votes")).getAllByText("No")[0]!.classList.contains("pill--neutral")).toBe(true);
    const none = within(table("Amendment votes")).getByText("No recent vote");
    expect(none.classList.contains("pill--off")).toBe(true);
    expect(none.querySelector("svg")).toBeTruthy();
  });

  it("keeps D's rows and draws D's statuses as the same pills when the amendments did not load: no moment, no share", () => {
    mountPage(build({ amendments: FAILED }));
    expect(rowsOf("Amendment votes").map((row) => row[1])).toEqual(["Activating", "Voting", "Voting", "Unknown"]);
    expect(statusPills()).toEqual([
      // A majority with no moment known: the clock and the word, with no comma left hanging.
      { text: "Activating", tone: "pill--info" },
      { text: "Voting", tone: "pill--neutral" },
      { text: "Voting", tone: "pill--neutral" },
      { text: "Unknown", tone: "pill--off" },
    ]);
  });

  it("draws a voting amendment A has no share of as the pill alone", () => {
    const list = amendmentsSample();
    const voting = list.amendments[1]!;
    const { votes: _votes, ...bare } = voting;
    mountPage(build({ amendments: ok({ ...list, amendments: list.amendments.map((row) => (row.id === voting.id ? bare : row)) }) }));
    expect(statusPills()[2]).toEqual({ text: "Voting", tone: "pill--neutral" });
  });

  it("says no vote is recorded when D has no record", () => {
    mountPage(build({ validator: validatorDetailSample({ amendment_votes: { yes: [], votes: [] } }) }));
    expect(card("Amendment votes").textContent).toContain("No vote recorded in the last 24 hours.");
    expect(card("Amendment votes").querySelector(".validator__foot")!.textContent).toBe("Amendments still being voted on. A validator that does not vote yes counts as no.");
  });
});

// ---- Recent validations --------------------------------------------------------------------------------------------------------------------

describe("ValidatorPage, recent validations", () => {
  it("is a live table of the board's columns, the source and the footer, with the ledger's link, the kind and the pill of each validation", () => {
    const { container } = mountPage(build());
    const recent = card("Recent validations");
    expect(within(recent).getByText("/v2/network/validators/{key}/validations")).toBeTruthy();
    expect(within(table("Recent validations")).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Ledger",
      "Ledger hash",
      "Signed (UTC)",
      "Kind",
      "Matches validated ledger",
    ]);
    expect(rowsOf("Recent validations")).toEqual([
      ["#107,748,007", "000000…1AA7", "16:26:20", "Partial", "Matches"],
      ["#107,748,006", "BBBBBB…BBBB", "16:26:16", "Full", "Different hash validated ledger 000000…1AA6"],
      ["#107,748,006", "000000…1AA6", "16:26:16", "Full", "Matches"],
      ["#107,748,005", "000000…1AA5", "16:26:12", "Full", "Matches"],
    ]);
    expect(within(table("Recent validations")).getAllByRole("link", { name: "#107,748,006" })[0]!.getAttribute("href")).toBe("/xrpl/ledger/107748006");
    expect(within(table("Recent validations")).getByText("Different hash").classList.contains("pill--bad")).toBe(true);
    // Keyed by ledger and hash: the two validations of one ledger are two rows.
    expect([...container.querySelectorAll('[role="table"][aria-label="Recent validations"] [data-key]')].map((row) => row.getAttribute("data-key"))).toEqual(
      validationsSample().validations.map((v) => `${v.ledger_index}:${v.ledger_hash}`),
    );
    expect(recent.textContent).toContain("Newest first. Partial validations do not count toward agreement. The data API keeps 7 days.");
  });

  it("says 'Not indexed yet' for a ledger the data API has not indexed", () => {
    const [first, ...rest] = validationsSample().validations;
    mountPage(build({ recent: ok(validationsSample({ validations: [{ ...first!, validated: "unknown" }, ...rest] })) }));
    const pill = within(table("Recent validations")).getByText("Not indexed yet");
    expect(pill.classList.contains("pill--neutral")).toBe(true);
    expect(pill.querySelector("svg")).toBeTruthy();
  });

  it("pages with Newer and Older: Older to the next marker, Newer not a link on the first page", () => {
    mountPage(build());
    const pager = within(screen.getByRole("navigation", { name: "Pagination" }));
    expect(pager.getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`/xrpl/validators/${KEY}?marker=${validationsSample().marker}`);
    expect(pager.queryByRole("link", { name: "Newer" })).toBeNull();
    expect(pager.getByText("Newer").getAttribute("aria-disabled")).toBe("true");
  });

  it("shows 'Couldn’t load the recent validations' with a Retry in place of the table when they did not load", async () => {
    const loader = vi.fn(() => null);
    mountPage(build({ recent: FAILED }), controls(), loader);
    const recent = card("Recent validations");
    expect(recent.textContent).toContain("Couldn’t load the recent validations.");
    expect(within(recent).queryByRole("table")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
    fireEvent.click(within(recent).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  });

  it("holds the page while a mouse is over the table, and not for the chart or the other tables", () => {
    const live = controls();
    mountPage(build(), live);
    const holds = () => (live.onHold as ReturnType<typeof vi.fn>).mock.calls.map(([held]) => held);
    fireEvent.pointerEnter(screen.getByRole("region", { name: "Daily agreement, scrollable table" }), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByRole("region", { name: "Fee votes, scrollable table" }), { pointerType: "mouse" });
    expect(holds()).toEqual([]);
    const scroll = screen.getByRole("region", { name: "Recent validations, scrollable table" });
    fireEvent.pointerEnter(scroll, { pointerType: "mouse" });
    fireEvent.pointerLeave(scroll, { pointerType: "mouse" });
    expect(holds()).toEqual([true, false]);
    act(() => within(scroll).getAllByRole("link")[0]!.focus());
    expect(holds().at(-1)).toBe(true);
  });
});

// ---- The stored page -----------------------------------------------------------------------------------------------------------------------

describe("ValidatorPage, the stored HTML", () => {
  it("holds absolute times and no age or countdown, and hydrates without a mismatch", async () => {
    const page = <ValidatorPage data={loaded(build())} live={controls()} />;
    const { html, errors } = await serverThenHydrated(routed(page));
    expect(html).not.toMatch(/ ago</);
    expect(html).not.toContain("in ~");
    expect(html).not.toMatch(/in \d+ days/);
    // Last seen is the newest validation's time, and the majority's pill its day.
    expect(html).toContain("2026-10-19 16:26:20 UTC");
    expect(html).toContain("expected Oct 31");
    expect(errors).toEqual([]);
  });

  it("is the same for D's coarse last seen", () => {
    const html = renderToString(routed(<ValidatorPage data={loaded(build({ recent: FAILED }))} live={controls()} />));
    expect(html).not.toMatch(/ ago</);
    expect(html).toContain("2026-10-19 19:24:52 UTC");
  });
});

// ---- The older validations ----------------------------------------------------------------------------------------------------------------

describe("ValidatorHistoryPage", () => {
  const MARKER = validationsSample().marker!;
  const history = (back: string[] = []) =>
    validatorHistoryPage({ network: XRPL, validator: validatorDetailSample(), recent: validationsSample() as ValidatorValidationsPage, marker: MARKER, back });

  it("has the breadcrumb, the h1 with its marks and the recent validations, and nothing live: no live row, no tiles, no other card", () => {
    const { container } = mountHistory(history());
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "XRPL/",
      "Network/",
      "Validators/",
      "northpeak.example",
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("northpeak.example");
    expect(screen.getByText("Domain verified")).toBeTruthy();
    expect(screen.getByText("UNL", { selector: ".tag" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Recent validations"]);
    expect(container.querySelector(".hero__status-row")).toBeNull();
    expect(screen.queryByRole("region", { name: "Agreement" })).toBeNull();
    expect(screen.queryByRole("button", { name: /live updates/ })).toBeNull();
    expect(rowsOf("Recent validations")).toHaveLength(4);
    // History: its rows are not live.
    expect(container.querySelector("[data-key]")).toBeNull();
  });

  it("pages back to the newer page it came from, and on to the older one, remembering the trail", () => {
    mountHistory(history(["M1"]));
    const pager = within(screen.getByRole("navigation", { name: "Pagination" }));
    expect(pager.getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`/xrpl/validators/${KEY}?marker=M1`);
    expect(pager.getByRole("link", { name: "Older" }).getAttribute("href")).toBe(`/xrpl/validators/${KEY}?marker=${MARKER}&back=${MARKER}.M1`);
  });

  it("goes back to the first page from a page reached with no trail", () => {
    mountHistory(history());
    expect(within(screen.getByRole("navigation", { name: "Pagination" })).getByRole("link", { name: "Newer" }).getAttribute("href")).toBe(`/xrpl/validators/${KEY}`);
  });
});

