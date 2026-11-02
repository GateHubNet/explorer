import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validatorRowSample } from "../../../test/support/d1-samples";
import type { ValidatorsParams } from "../../domain/validators-params";
import type { ValidatorRow } from "../../server/api-types";
import { validatorMapOf } from "../../server/validator-map-view";
import type { NetworkInfo } from "../networks";
import type { HoldHandlers } from "../use-hold";
import { tipTransform, ValidatorsMapCard } from "./ValidatorsMapCard";

afterEach(cleanup);

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const XAHAU: NetworkInfo = { id: "xahau", kind: "mainnet", name: "Xahau", label: "Xahau mainnet", longName: "Xahau", dexName: "the Xahau DEX", native: "XAH", software: "xahaud" };

/** How many validators a country has and how many of them are on the UNL. */
type Fleet = Record<string, [validators: number, unl: number]>;

let serial = 0;
/** L's rows for a fleet, then `unknown` validators whose toml places none of them. */
function rowsOf(fleet: Fleet, unknown = 0): ValidatorRow[] {
  const rows: ValidatorRow[] = [];
  const row = (over: Partial<ValidatorRow>) => validatorRowSample({ validation_public_key: `nCardKey${(serial += 1)}`, ...over });
  for (const [code, [validators, unl]] of Object.entries(fleet)) {
    for (let i = 0; i < validators; i += 1) rows.push(row({ unl: i < unl, toml: { server_country: code } }));
  }
  for (let i = 0; i < unknown; i += 1) rows.push(row({ unl: false }));
  return rows;
}

type Map = Parameters<typeof ValidatorsMapCard>[0]["map"];

function mapOf(fleet: Fleet, over: { unknown?: number; params?: ValidatorsParams; network?: NetworkInfo; truncated?: boolean } = {}): Map {
  return { state: "ok", ...validatorMapOf({ network: over.network ?? XRPL, params: over.params ?? { scope: "unl" }, rows: rowsOf(fleet, over.unknown), truncated: over.truncated ?? false }) };
}

const holdHandlers = (): HoldHandlers => ({ onPointerEnter: vi.fn(), onPointerLeave: vi.fn(), onFocus: vi.fn(), onBlur: vi.fn() });

function mount(map: Map, props: { holds?: HoldHandlers; onRetry?: () => void; retrying?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={["/xrpl/validators"]}>
      <ValidatorsMapCard map={map} holds={props.holds ?? holdHandlers()} onRetry={props.onRetry ?? vi.fn()} retrying={props.retrying ?? false} />
    </MemoryRouter>,
  );
}

const htmlOf = (map: Map) =>
  renderToString(
    <MemoryRouter initialEntries={["/xrpl/validators"]}>
      <ValidatorsMapCard map={map} holds={holdHandlers()} onRetry={() => {}} retrying={false} />
    </MemoryRouter>,
  );

/** The countries the tests draw: Germany the largest, then Panama and the United States, with Cuba the smallest. West to east: US, CU, PA, DE (CU and PA are at one longitude: CU is north). */
const FLEET: Fleet = { DE: [5, 2], PA: [4, 1], US: [3, 3], CU: [1, 0] };

const group = () => screen.getByRole("group", { name: "Map of validators by country" });
const circle = (name: string | RegExp) => within(group()).getByRole("link", { name });
const circles = () => within(group()).getAllByRole("link");
const table = () => screen.getByRole("table", { name: "Validators by country" });
const tableRow = (country: string) => within(table()).getByRole("link", { name: country }).closest<HTMLElement>('[role="row"]')!;
const tip = () => document.querySelector(".vmap__tip");

describe("ValidatorsMapCard", () => {
  it("draws each circle as a link with its name, and aria-current on the chosen one", () => {
    mount(mapOf(FLEET, { params: { scope: "unl", country: "DE" } }));
    expect(circles().map((link) => link.getAttribute("aria-label"))).toEqual([
      "Germany: 5 validators, 2 on the UNL",
      "Panama: 4 validators, 1 on the UNL",
      "United States: 3 validators, 3 on the UNL",
      "Cuba: 1 validator, 0 on the UNL",
    ]);
    const germany = circle("Germany: 5 validators, 2 on the UNL");
    // The chosen country's link clears it; the others choose theirs.
    expect(germany.getAttribute("href")).toBe("/xrpl/validators");
    expect(germany.getAttribute("aria-current")).toBe("true");
    expect(circle(/^United States/).getAttribute("href")).toBe("/xrpl/validators?country=US");
    expect(circles().filter((link) => link.getAttribute("aria-current") === "true")).toHaveLength(1);
    // Placed by the table's point, sized by the count; the dim ones are the others.
    expect(germany.style.left).toBe("52.89%");
    expect(germany.style.top).toBe("19.68%");
    expect(germany.style.getPropertyValue("--d")).toBe("44px");
    expect(circle(/^Cuba/).style.getPropertyValue("--d")).toBe("19.7px");
    expect(germany.classList.contains("is-current")).toBe(true);
    expect(germany.classList.contains("is-dim")).toBe(false);
    expect(circle(/^Cuba/).classList.contains("is-dim")).toBe(true);
  });

  it("draws the dots with <use> of the asset and never with the path itself", () => {
    const html = htmlOf(mapOf(FLEET));
    expect(html).toMatch(/<use href="[^"]*world-dots[^"]*\.svg#dots"/);
    expect(html).not.toContain("M316.0 3.5h0");
    mount(mapOf(FLEET));
    const svg = group().querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 378");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("is one Tab stop: the chosen circle, else the largest", () => {
    mount(mapOf(FLEET));
    expect(circles().map((link) => [link.getAttribute("aria-label")!.split(":")[0], link.tabIndex])).toEqual([
      ["Germany", 0],
      ["Panama", -1],
      ["United States", -1],
      ["Cuba", -1],
    ]);
    cleanup();
    mount(mapOf(FLEET, { params: { scope: "unl", country: "US" } }));
    expect(circles().map((link) => link.tabIndex)).toEqual([-1, -1, 0, -1]);
    // The server's HTML has the same stops (the tooltip is not in it).
    const html = htmlOf(mapOf(FLEET));
    expect([...html.matchAll(/<a [^>]*class="vmap__circle[^>]*>/g)].map((match) => /tabindex="(-?\d)"/.exec(match[0])![1])).toEqual(["0", "-1", "-1", "-1"]);
    expect(html).not.toContain("vmap__tip");
  });

  it("moves the Tab stop with the arrow keys, so Shift+Tab and Tab leave the map from the circle that has focus", () => {
    mount(mapOf(FLEET));
    const stops = () => circles().filter((link) => link.tabIndex === 0).map((link) => link.getAttribute("aria-label")!.split(":")[0]);
    expect(stops()).toEqual(["Germany"]);
    act(() => circle(/^Germany/).focus());
    expect(stops()).toEqual(["Germany"]);
    // West to east is United States, Cuba, Panama, Germany: each circle that takes focus is the only Tab stop.
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(stops()).toEqual(["United States"]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(stops()).toEqual(["Cuba"]);
    // It stays there when focus leaves the map: Tab from before the map comes back to it.
    act(() => (document.activeElement as HTMLElement).blur());
    expect(stops()).toEqual(["Cuba"]);
    // A circle that takes focus any other way (a click) is the stop too.
    act(() => circle(/^Panama/).focus());
    expect(stops()).toEqual(["Panama"]);
  });

  it("falls back to the chosen or the largest circle when the circle that held the stop is gone", () => {
    const view = mount(mapOf(FLEET));
    act(() => circle(/^United States/).focus());
    const stopName = () => circles().filter((link) => link.tabIndex === 0).map((link) => link.getAttribute("aria-label")!.split(":")[0]);
    expect(stopName()).toEqual(["United States"]);
    view.rerender(
      <MemoryRouter initialEntries={["/xrpl/validators"]}>
        <ValidatorsMapCard map={mapOf({ DE: FLEET.DE!, PA: FLEET.PA!, CU: FLEET.CU! })} holds={holdHandlers()} onRetry={vi.fn()} retrying={false} />
      </MemoryRouter>,
    );
    // The map with no United States has Germany, the largest, for its stop, and the stale code is not a second one.
    expect(stopName()).toEqual(["Germany"]);
    // Back again: the code is a circle once more, and it is the stop.
    view.rerender(
      <MemoryRouter initialEntries={["/xrpl/validators"]}>
        <ValidatorsMapCard map={mapOf(FLEET)} holds={holdHandlers()} onRetry={vi.fn()} retrying={false} />
      </MemoryRouter>,
    );
    expect(stopName()).toEqual(["United States"]);
  });

  it("names the group and describes it by the attribution", () => {
    mount(mapOf(FLEET));
    const described = group().getAttribute("aria-describedby")!;
    const attribution = document.getElementById(described)!;
    expect(attribution.textContent).toBe(
      "Validator locations come from server_country in each validator's verified xrp-ledger.toml. A validator without a verified toml, or whose toml gives no valid server_country, has an unknown location.",
    );
    cleanup();
    mount(mapOf(FLEET, { network: XAHAU }));
    expect(document.getElementById(group().getAttribute("aria-describedby")!)!.textContent).toContain("verified xahau.toml.");
  });

  it("moves focus west to east with the arrows, and to the ends with Home and End", () => {
    mount(mapOf(FLEET));
    const focused = () => document.activeElement?.getAttribute("aria-label")?.split(":")[0];
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    act(() => circle(/^Germany/).focus());
    // West to east is United States, Cuba, Panama, Germany.
    expect(press("Home")).toBe(false);
    expect(focused()).toBe("United States");
    expect(press("ArrowRight")).toBe(false);
    expect(focused()).toBe("Cuba");
    press("ArrowDown");
    expect(focused()).toBe("Panama");
    press("ArrowRight");
    expect(focused()).toBe("Germany");
    // The last stays last, and the first first.
    press("ArrowRight");
    expect(focused()).toBe("Germany");
    press("ArrowLeft");
    expect(focused()).toBe("Panama");
    press("ArrowUp");
    expect(focused()).toBe("Cuba");
    press("End");
    expect(focused()).toBe("Germany");
    press("Home");
    press("ArrowLeft");
    expect(focused()).toBe("United States");
    // Other keys are left to the browser: Enter follows the link, Tab leaves.
    expect(press("Enter")).toBe(true);
    expect(press("Tab")).toBe(true);
  });

  it("leaves a modified arrow key to the browser: Alt, Ctrl or Cmd with it is Back, Forward and the like", () => {
    mount(mapOf(FLEET));
    const focused = () => document.activeElement?.getAttribute("aria-label")?.split(":")[0];
    act(() => circle(/^Germany/).focus());
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
        // `fireEvent` returns false when a handler called preventDefault: true says the browser still has the key.
        expect(fireEvent.keyDown(document.activeElement!, { key, [modifier]: true })).toBe(true);
        expect(focused()).toBe("Germany");
      }
    }
    // Shift does not make it the browser's: it still moves.
    expect(fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft", shiftKey: true })).toBe(false);
    expect(focused()).toBe("Panama");
  });

  it("shows the tooltip on focus and hover, and hides it on Escape", () => {
    mount(mapOf(FLEET));
    expect(tip()).toBeNull();
    act(() => circle(/^Germany/).focus());
    expect(tip()!.getAttribute("aria-hidden")).toBe("true");
    expect(Array.from(tip()!.children, (part) => part.textContent)).toEqual(["Germany", "5 validators · 2 on the UNL", "38.5% of the validators in All", "Select to show only this country in the list"]);
    // Beside the circle, by the board's rule.
    expect((tip() as HTMLElement).style.left).toBe("52.89%");
    expect((tip() as HTMLElement).style.transform).toBe(tipTransform({ left: "52.89%", top: "19.68%", size: 44 }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(tip()).toBeNull();
    // Another circle shows its own again; leaving it hides it.
    act(() => circle(/^United States/).focus());
    expect(tip()!.textContent).toContain("United States");
    act(() => circle(/^United States/).blur());
    expect(tip()).toBeNull();

    fireEvent.pointerEnter(circle(/^Panama/), { pointerType: "mouse" });
    expect(tip()!.textContent).toContain("Panama");
    // Escape works with the pointer alone, with no focus in the card.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(tip()).toBeNull();
    fireEvent.pointerLeave(circle(/^Panama/), { pointerType: "mouse" });
    fireEvent.pointerEnter(circle(/^Panama/), { pointerType: "mouse" });
    expect(tip()!.textContent).toContain("Panama");
    fireEvent.pointerLeave(circle(/^Panama/), { pointerType: "mouse" });
    expect(tip()).toBeNull();
    // A finger shows none: the tap follows the link.
    fireEvent.pointerEnter(circle(/^Panama/), { pointerType: "touch" });
    expect(tip()).toBeNull();
  });

  it("says in the tooltip of the chosen country that a second select shows every country again", () => {
    mount(mapOf(FLEET, { params: { scope: "unl", country: "DE" } }));
    act(() => circle(/^Germany/).focus());
    expect(tip()!.textContent).toContain("Select to show every country again");
  });

  it("highlights the row of a hovered or focused circle and the circle of a hovered row", () => {
    mount(mapOf(FLEET, { params: { scope: "unl", country: "US" } }));
    const highlighted = () => [...group().querySelectorAll(".is-highlighted")].map((element) => element.getAttribute("data-code")).concat([...table().querySelectorAll(".is-highlighted")].map((element) => `row ${element.getAttribute("data-key")}`));
    expect(highlighted()).toEqual([]);
    fireEvent.pointerEnter(circle(/^Panama/), { pointerType: "mouse" });
    expect(highlighted()).toEqual(["PA", "row PA"]);
    fireEvent.pointerLeave(circle(/^Panama/), { pointerType: "mouse" });
    expect(highlighted()).toEqual([]);
    act(() => circle(/^Cuba/).focus());
    expect(highlighted()).toEqual(["CU", "row CU"]);
    act(() => circle(/^Cuba/).blur());
    // The pointer over a row highlights its circle, and not a tooltip.
    fireEvent.pointerEnter(tableRow("Germany"), { pointerType: "mouse" });
    expect(highlighted()).toEqual(["DE", "row DE"]);
    expect(tip()).toBeNull();
    fireEvent.pointerLeave(tableRow("Germany"), { pointerType: "mouse" });
    expect(highlighted()).toEqual([]);
    // The chosen row is marked as such.
    expect(tableRow("United States").classList.contains("is-current")).toBe(true);
    expect(tableRow("Germany").classList.contains("is-current")).toBe(false);
  });

  it("draws the countries table: a link to each country, in order, with its counts and share", () => {
    mount(mapOf(FLEET, { params: { scope: "unl", country: "US" }, unknown: 3 }));
    expect(within(table()).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Country", "Validators", "On UNL", "Share"]);
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("data-key"))).toEqual(["DE", "PA", "US", "CU"]);
    const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);
    // 16 validators in all: Germany 5 of 16.
    expect(cells(rows[0]!)).toEqual(["Germany", "5", "2", "31.3%"]);
    expect(cells(rows[2]!)).toEqual(["United States", "3", "3", "18.8%"]);
    const links = within(table()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/xrpl/validators?country=DE", "/xrpl/validators?country=PA", "/xrpl/validators", "/xrpl/validators?country=CU"]);
    expect(links.filter((link) => link.getAttribute("aria-current") === "true").map((link) => link.textContent)).toEqual(["United States"]);
    // The meter is a graphic beside the text: hidden, so that the share is read once.
    expect(rows[0]!.querySelector(".meter")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(rows[0]!).queryByRole("img")).toBeNull();
    // The region is named for the table, a keyboard can scroll it, and it is capped.
    const region = screen.getByRole("region", { name: "Validators by country, scrollable table" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect((region as HTMLElement).style.maxHeight).toBe("282px");
  });

  it("heads the card, and names the chosen country with a link that clears it", () => {
    mount(mapOf(FLEET));
    const card = screen.getByRole("region", { name: "Where validators are" });
    expect(card.tagName).toBe("SECTION");
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe("Where validators are");
    expect(card.textContent).toContain("/v2/network/validators");
    expect(within(card).queryByRole("link", { name: "Clear country" })).toBeNull();
    cleanup();
    mount(mapOf(FLEET, { params: { scope: "all", q: "x", country: "DE" } }));
    expect(screen.getByText(/^The list below shows/).textContent).toBe("The list below shows GermanyClear country");
    expect(screen.getByRole("link", { name: "Clear country" }).getAttribute("href")).toBe("/xrpl/validators?scope=all&q=x");
  });

  it("links the unknown chip, and draws no link at 0", () => {
    mount(mapOf(FLEET, { unknown: 3, params: { scope: "all", q: "x" } }));
    const chip = screen.getByRole("link", { name: "Unknown location: 3 validators" });
    expect(chip.getAttribute("href")).toBe("/xrpl/validators?scope=all&country=unknown&q=x");
    cleanup();
    mount(mapOf(FLEET, { unknown: 1 }));
    expect(screen.getByRole("link", { name: "Unknown location: 1 validator" })).toBeTruthy();
    cleanup();
    mount(mapOf(FLEET));
    expect(screen.queryByRole("link", { name: /Unknown location/ })).toBeNull();
    expect(screen.getByText(/^Unknown location:/).textContent).toBe("Unknown location: 0 validators");
    expect(screen.getByText(/^Unknown location:/).closest("a")).toBeNull();
  });

  it("draws the legend, and E6's sentence when L was cut", () => {
    mount(mapOf(FLEET));
    const card = screen.getByRole("region", { name: "Where validators are" });
    expect(card.textContent).toContain("Validators, located by their toml");
    expect(card.textContent).toContain("Circle area shows the count");
    expect(card.textContent).not.toContain("The first 1,000 validators in this order are shown.");
    cleanup();
    mount(mapOf(FLEET, { truncated: true }));
    expect(screen.getByText("The first 1,000 validators in this order are shown.")).toBeTruthy();
  });

  it("draws the empty state and the unplaced note", () => {
    // No toml gives a server country: the dots, no circle, the table's words and the chip.
    mount(mapOf({}, { unknown: 4 }));
    expect(group().querySelector("svg")).not.toBeNull();
    expect(within(group()).queryAllByRole("link")).toEqual([]);
    expect(screen.getByText("No validator's toml gives a server country yet.")).toBeTruthy();
    expect(within(table()).queryAllByRole("row").slice(1)).toEqual([]);
    expect(screen.getByRole("link", { name: "Unknown location: 4 validators" })).toBeTruthy();
    cleanup();
    // A code this build does not place: a row of text named by its code, no circle, and the note.
    mount(mapOf({ DE: [2, 0], QQ: [1, 1] }));
    expect(circles().map((link) => link.getAttribute("aria-label")!.split(":")[0])).toEqual(["Germany"]);
    expect(within(table()).queryByRole("link", { name: "QQ" })).toBeNull();
    const unplaced = within(table()).getByText("QQ").closest<HTMLElement>('[role="row"]')!;
    expect(unplaced.getAttribute("data-key")).toBe("QQ");
    expect(within(unplaced).queryByRole("link")).toBeNull();
    expect(document.getElementById(group().getAttribute("aria-describedby")!)!.textContent).toMatch(/ 1 validator is in a country the map does not place: QQ\.$/);
  });

  it("draws SectionError when the map failed, and nothing when it is off", () => {
    const onRetry = vi.fn();
    mount({ state: "failed" }, { onRetry });
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t load where validators are.");
    expect(screen.queryByRole("group", { name: "Map of validators by country" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    // The card keeps its heading, so that the page does not lose its place.
    expect(screen.getByRole("heading", { level: 2, name: "Where validators are" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();
    mount({ state: "failed" }, { retrying: true });
    expect((screen.getByRole("button", { name: "Retrying…" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const { container } = mount({ state: "off" });
    expect(container.innerHTML).toBe("");
    expect(htmlOf({ state: "off" })).toBe("");
  });

  it("holds the page while the pointer or focus is on the card", () => {
    const holds = holdHandlers();
    mount(mapOf(FLEET), { holds });
    const card = screen.getByRole("region", { name: "Where validators are" });
    fireEvent.pointerEnter(card, { pointerType: "mouse" });
    expect(holds.onPointerEnter).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(card, { pointerType: "mouse" });
    expect(holds.onPointerLeave).toHaveBeenCalledTimes(1);
    fireEvent.focus(circle(/^Germany/));
    expect(holds.onFocus).toHaveBeenCalled();
  });

  it("places the tooltip by the board's rule", () => {
    // Horizontally: 14 px in from the edge in the first and last 20 % of the box, else centred. The 220 px tooltip, centred, would pass the card's clip on the narrowest card that draws it
    // (560 px, a map of 528 px) from 86 % on, and South Korea sits at 85.53 %: so it flips from 80 %, and on the west side from 20 %.
    const x = (left: string) => /^translate\((.*), /.exec(tipTransform({ left, top: "20.00%", size: 44 }))![1];
    expect([x("10.00%"), x("19.00%"), x("20.00%"), x("21.00%"), x("50.00%"), x("79.00%"), x("80.00%"), x("81.00%"), x("90.00%")]).toEqual([
      "-14px",
      "-14px",
      "-50%",
      "-50%",
      "-50%",
      "-50%",
      "-50%",
      "calc(-100% + 14px)",
      "calc(-100% + 14px)",
    ]);
    expect(x("85.53%")).toBe("calc(-100% + 14px)");
    // Vertically: below the circle (half its size and 8 px) in the upper part, above it elsewhere.
    expect(tipTransform({ left: "50.00%", top: "20.00%", size: 44 })).toBe("translate(-50%, 30px)");
    expect(tipTransform({ left: "50.00%", top: "60.00%", size: 44 })).toBe("translate(-50%, calc(-100% - 30px))");
    expect(tipTransform({ left: "50.00%", top: "41.99%", size: 10 })).toBe("translate(-50%, 13px)");
    expect(tipTransform({ left: "50.00%", top: "42.00%", size: 10 })).toBe("translate(-50%, calc(-100% - 13px))");
    expect(tipTransform({ left: "10.00%", top: "60.00%", size: 19.7 })).toBe("translate(-14px, calc(-100% - 17.85px))");
  });
});
