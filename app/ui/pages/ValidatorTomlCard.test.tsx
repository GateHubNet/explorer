import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { validatorDetailSample } from "../../../test/support/d1-samples";
import { shortAddress } from "../../domain/format";
import { NO_NAMES, type NamesPart, type NameView } from "../../domain/names";
import type { ValidatorTomlDetail } from "../../server/api-types";
import { tomlCardOf, type TomlCardView } from "../../server/validator-view";
import { featuresOf } from "../features";
import { NamesProvider } from "../names";
import type { NetworkInfo } from "../networks";
import { ValidatorTomlCard } from "./ValidatorTomlCard";

afterEach(cleanup);

// ---- The world of the tests ------------------------------------------------------------------------------------------------------------------

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const OTHER = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const ON = featuresOf({ VALIDATORS_MAP: "on", TOKENS: "on" });
const NORTHPEAK: NameView = { name: { text: "Northpeak Treasury", kind: "verified" }, domain: "northpeak.example", labels: [] };

const FULL: ValidatorTomlDetail = {
  owner_country: "DE",
  server_country: "NL",
  network: "testnet",
  unl: "https://vl.ripple.com/x",
  principals: ["Mara Lindqvist", "Tomas Okafor"],
  modified: "2026-10-02T00:00:00Z",
  accounts_listed: 4,
  currencies: [{ code: "USD", issuer: ACCOUNT }, { code: "EUR" }],
  currencies_listed: 5,
};

/** The card `tomlCardOf` makes of `northpeak.example` (verified, listing the accounts `accounts`) with `toml` as D8 gave it. */
function cardOf(toml: ValidatorTomlDetail | undefined, accounts: string[] = [ACCOUNT]): TomlCardView {
  const validator = validatorDetailSample({
    ...(toml === undefined ? {} : { toml }),
    domain_verification: { status: "verified", toml_url: "https://northpeak.example/.well-known/xrp-ledger.toml", checked: "2026-10-19T19:15:52.489Z", accounts },
  });
  return tomlCardOf({ network: XRPL, validator, features: ON })!;
}

/** The card in a router (its currencies and accounts are links) and the names of its page. */
function mount(card: TomlCardView, names: NamesPart = NO_NAMES) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <NamesProvider names={names.map}>
            <ValidatorTomlCard card={card} net="xrpl" />
          </NamesProvider>
        ),
      },
    ],
    { initialEntries: ["/xrpl/validators/nKey"] },
  );
  return render(<RouterProvider router={router} />);
}

const section = () => screen.getByRole("region", { name: "From northpeak.example's toml" });
/** A fact of the grid by its label: its value and the line under it. */
function fact(label: string) {
  const element = within(section()).getByText(label, { selector: ".validator__label" }).closest(".validator__fact")!;
  return { element, value: element.querySelector(".validator__value")!, sub: element.querySelector(".validator__sub")?.textContent ?? null };
}
const listOf = (name: string) => within(section()).getByRole("group", { name });

// ---- The head and the checks -----------------------------------------------------------------------------------------------------------------

describe("ValidatorTomlCard", () => {
  it("draws the head, the View toml link with its hidden file name, and the two passed checks", () => {
    mount(cardOf(FULL));

    expect(within(section()).getByRole("heading", { level: 2 }).textContent).toBe("From northpeak.example's toml");
    expect(section().querySelector(".chart__source")!.textContent).toBe("/v2/network/validators/{key}");
    // The file's name is read after the visible words (the engine may put a space between the arrow and the comma), then the link's own "opens in a new tab".
    const link = within(section()).getByRole("link", { name: /^View toml → ?, xrp-ledger\.toml \(opens in a new tab\)$/ });
    expect(link.getAttribute("href")).toBe("https://northpeak.example/.well-known/xrp-ledger.toml");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link.querySelector(".sr")!.textContent).toBe(", xrp-ledger.toml");

    expect(within(section()).getByText("Domain, verified both ways")).toBeTruthy();
    const checks = within(section()).getAllByRole("listitem");
    expect(checks.map((item) => item.textContent)).toEqual([
      "Passed: The validator's manifest names northpeak.example.",
      "Passed: The [[VALIDATORS]] list in northpeak.example's xrp-ledger.toml includes this master key.",
    ]);
    // The tick is decorative; "Passed: " is what a screen reader reads in its place.
    for (const item of checks) {
      expect(item.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
      expect(item.querySelector(".sr")!.textContent).toBe("Passed: ");
    }
  });

  it("draws no link to the file when the builder gave no address, and the rest of the card as it is", () => {
    mount({ ...cardOf(FULL), href: null });
    expect(within(section()).queryByRole("link", { name: /View toml/ })).toBeNull();
    expect(within(section()).getByRole("heading", { level: 2 })).toBeTruthy();
    expect(within(section()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("is Xahau's file when the builder says so", () => {
    mount({ ...cardOf(FULL), file: "xahau.toml", href: "https://northpeak.example/.well-known/xahau.toml" });
    expect(within(section()).getByRole("link", { name: /^View toml → ?, xahau\.toml \(opens in a new tab\)$/ })).toBeTruthy();
  });
});

// ---- The facts --------------------------------------------------------------------------------------------------------------------------------

describe("ValidatorTomlCard, the facts", () => {
  it("draws the facts in order, a mono value and its sub", () => {
    mount(cardOf(FULL));

    const labels = Array.from(section().querySelectorAll(".validator__tomlgrid .validator__label"), (label) => label.textContent);
    expect(labels).toEqual(["Owner country", "Server country", "Network", "On a UNL, says the toml", "Principals", "Last modified"]);

    expect(fact("Owner country").value.textContent).toBe("Germany");
    expect(fact("Server country").value.textContent).toBe("Netherlands");
    // The network's value is mono as a whole, and the name under it says it is another network's.
    const network = fact("Network");
    expect(network.value.textContent).toBe("testnet");
    expect(network.value.querySelector(".mono")!.textContent).toBe("testnet");
    expect(network.sub).toBe("XRPL Testnet, not this network");
    // The UNL's: "Yes · " in the page's face and the host in mono, never a link.
    const unl = fact("On a UNL, says the toml");
    expect(unl.value.textContent).toBe("Yes · vl.ripple.com");
    expect(unl.value.querySelector(".mono")!.textContent).toBe("vl.ripple.com");
    expect(unl.value.querySelector("a")).toBeNull();
    expect(unl.sub).toBe("its own claim; UNL membership above is from the lists");
    expect(fact("Principals").value.textContent).toBe("Mara Lindqvist and Tomas Okafor");
    expect(fact("Last modified")).toMatchObject({ sub: "from [METADATA]" });
    expect(fact("Last modified").value.textContent).toBe("Oct 2, 2026");
    // A value in the page's face is not mono.
    expect(fact("Owner country").value.querySelector(".mono")).toBeNull();
  });

  it("draws Server country Not given alone, with what it means, for a toml that gives nothing", () => {
    mount(cardOf({}));
    expect(Array.from(section().querySelectorAll(".validator__tomlgrid .validator__label"), (label) => label.textContent)).toEqual(["Server country"]);
    expect(fact("Server country")).toMatchObject({ sub: "so its location is unknown" });
    expect(fact("Server country").value.textContent).toBe("Not given");
  });

  it("says the data API has not read the details yet, and draws no fact", () => {
    mount(cardOf(undefined));
    expect(within(section()).getByText("The data API has not read this toml's details yet.")).toBeTruthy();
    expect(section().querySelector(".validator__tomlgrid")).toBeNull();
    expect(within(section()).queryByText("Server country")).toBeNull();
    // The head, the checks and the accounts the domain lists are D1's, and are all there.
    expect(within(section()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(listOf("Accounts [[ACCOUNTS]]")).getByRole("link").getAttribute("href")).toBe(`/xrpl/account/${ACCOUNT}`);
    expect(within(section()).queryByRole("group", { name: "Currencies [[CURRENCIES]]" })).toBeNull();
  });
});

// ---- The lists --------------------------------------------------------------------------------------------------------------------------------

describe("ValidatorTomlCard, the lists", () => {
  it("draws each account by AccountLink, and and N more", () => {
    const names = { state: "ok", map: { [ACCOUNT]: NORTHPEAK } } satisfies NamesPart;
    mount(cardOf({ ...FULL, accounts_listed: 1234 }, [ACCOUNT, OTHER]), names);

    const accounts = listOf("Accounts [[ACCOUNTS]]");
    const links = within(accounts).getAllByRole("link");
    // A name with the mark that says how it is known, then the short address of the one nobody names; each to its page.
    expect(links.map((link) => link.textContent)).toEqual(["Northpeak Treasury verified name", shortAddress(OTHER)]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([ACCOUNT, OTHER].map((address) => `/xrpl/account/${address}`));
    expect(links[1]!.getAttribute("title")).toBe(OTHER);
    expect(accounts.textContent).toContain("1,234 listed:");
    expect(accounts.textContent).toContain("and 1,232 more");
    // The count leads the addresses, and the sentence about the rest ends the list.
    expect(accounts.textContent!.indexOf("listed:")).toBeLessThan(accounts.textContent!.indexOf("Northpeak"));
    expect(accounts.textContent!.indexOf("and 1,232 more")).toBeGreaterThan(accounts.textContent!.indexOf(shortAddress(OTHER)));
  });

  it("says nothing more for accounts when the toml lists no more than are shown, and leaves the list out when there are none", () => {
    mount(cardOf({ accounts_listed: 1 }));
    expect(listOf("Accounts [[ACCOUNTS]]").textContent).not.toContain("more");
    cleanup();
    mount(cardOf({}, []));
    expect(within(section()).queryByRole("group", { name: "Accounts [[ACCOUNTS]]" })).toBeNull();
  });

  it("links a currency only when it has an href", () => {
    mount(cardOf(FULL));

    const currencies = listOf("Currencies [[CURRENCIES]]");
    const links = within(currencies).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["USD", `/xrpl/token/USD.${ACCOUNT}`]]);
    // EUR names no issuer: mono text, not a link.
    const eur = within(currencies).getByText("EUR");
    expect(eur.tagName).toBe("SPAN");
    expect(eur.classList.contains("mono")).toBe(true);
    expect(within(currencies).getByText("and 3 more")).toBeTruthy();
  });

  it("leaves the currencies out when the toml names none", () => {
    mount(cardOf({ server_country: "US" }));
    expect(within(section()).queryByText("Currencies")).toBeNull();
    expect(within(section()).queryByRole("group", { name: "Currencies [[CURRENCIES]]" })).toBeNull();
  });
});
