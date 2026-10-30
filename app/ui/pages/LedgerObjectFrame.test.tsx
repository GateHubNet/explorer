import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import { checkAnswerSample, TOKEN_ISSUER } from "../../../test/support/object-samples";
import { stateOf, XRPL } from "../../../test/support/object-view-world";
import { LAYOUT_XRPL, mountPage, routedPage } from "../../../test/support/under-network";
import type { Segment } from "../../domain/describe";
import { NO_NAMES } from "../../domain/names";
import { formatDateTime } from "../../domain/time-words";
import { checkPage } from "../../server/check-view";
import type { DisplayAmount } from "../../server/ledger-object-view";
import { NamesProvider } from "../names";
import { CheckPage } from "./CheckPage";
import { AmountValue, ObjectStatus } from "./LedgerObjectFrame";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// What the three object pages draw the same way: the summary and the status lines with the age of each date they name (`ObjectStatus`), an amount of the object (`AmountValue`), and the
// breadcrumb the frame builds from the row that names the holder of the object. The pages' own tests (EscrowPage, CheckPage, PaymentChannelPage) draw each through its page.

const PATH = "/xrpl/checks/60FCB1E8C72A695CBB6BDF718D30AF2310A9BED6D3F6D92F54C0E429186D1A42";
const NOW = Date.UTC(2026, 9, 29, 4, 0, 0) / 1000;
const AS_OF = Date.UTC(2026, 9, 29, 3, 50, 41) / 1000;
const SOON = Date.UTC(2026, 10, 2, 4, 0, 0) / 1000;
const BEFORE = Date.UTC(2026, 9, 16, 17, 49, 0) / 1000;
const ACCOUNT = "r9CaVb4X1JVQoi6Q8Gw5cznAMRFARJDWyN";

const text = (v: string): Segment => ({ t: "text", v });
const dated = (at: number) => formatDateTime(at);

const status = (props: Partial<Parameters<typeof ObjectStatus>[0]> = {}) => (
  <NamesProvider names={{}}>
    <ObjectStatus
      net="xrpl"
      summary={[{ t: "account", v: ACCOUNT }, text(" wrote a check.")]}
      statusLines={[[text(`Open until ${dated(SOON)}`)], [text(`Its expiration passed on ${dated(BEFORE)}. Nothing else is dated.`)]]}
      moments={[SOON, BEFORE]}
      asOf={AS_OF}
      {...props}
    />
  </NamesProvider>
);

describe("ObjectStatus", () => {
  it("draws the summary as a sentence and the status lines under it, the first as the headline", () => {
    const { container } = mountPage(status(), "frame", { at: PATH, network: LAYOUT_XRPL });
    const summary = container.querySelector("p.sentence.object-page__summary")!;
    expect(summary.textContent).toBe("r9CaVb…DWyN wrote a check.");
    expect(within(summary as HTMLElement).getByRole("link", { name: "r9CaVb…DWyN" }).getAttribute("href")).toBe(`/xrpl/account/${ACCOUNT}`);
    const lines = [...container.querySelectorAll(".object-page__status > p")];
    expect(lines.map((line) => line.className)).toEqual(["object-page__headline", ""]);
  });

  it("puts the age of each date it names right after it: the countdown of one to come, the age of one that passed, told against the moment the page is as of", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW * 1000));
    const { container } = await serverThenHydrated(routedPage(status(), { at: PATH }));
    await act(async () => {});
    expect([...container.querySelectorAll(".object-page__status > p")].map((line) => line.textContent)).toEqual([
      `Open until ${dated(SOON)}in 4 days`,
      `Its expiration passed on ${dated(BEFORE)}12 d ago. Nothing else is dated.`,
    ]);
    // The age is in a `<time>` of its own, which the stylesheet puts in brackets.
    expect([...container.querySelectorAll("time.object-page__age")].map((time) => time.getAttribute("datetime"))).toEqual([new Date(SOON * 1000).toISOString(), new Date(BEFORE * 1000).toISOString()]);
  });

  it("holds no age in the HTML the Worker prints, and hydrates it without a mismatch", async () => {
    const { html, errors } = await serverThenHydrated(routedPage(status(), { at: PATH }));
    expect(errors).toEqual([]);
    expect(html).not.toMatch(/\bago\b|\bin \d+ (?:s|min|h|days)/);
    expect(html.match(/<time[^>]*class="object-page__age"[^>]*><\/time>/g)).toHaveLength(2);
  });

  it("writes a line with no date of `moments` as it is, and a date it was not given no age", () => {
    const { container } = mountPage(status({ statusLines: [[text("Nothing is dated here")], [text(`Written ${dated(SOON)}`)]], moments: [] }), "frame", { at: PATH, network: LAYOUT_XRPL });
    expect(container.querySelectorAll("time")).toHaveLength(0);
    expect([...container.querySelectorAll(".object-page__status > p")].map((line) => line.textContent)).toEqual(["Nothing is dated here", `Written ${dated(SOON)}`]);
  });

  it("draws no status lines for a page with none", () => {
    const { container } = mountPage(status({ statusLines: [] }), "frame", { at: PATH, network: LAYOUT_XRPL });
    expect(container.querySelector(".object-page__status")!.children).toHaveLength(0);
    expect(container.querySelector(".object-page__summary")).not.toBeNull();
  });
});

describe("AmountValue", () => {
  const token: DisplayAmount = { value: "1,000", currency: "524C555344000000000000000000000000000000", issuer: TOKEN_ISSUER };
  const draw = (amount: DisplayAmount, link: boolean) => mountPage(<AmountValue net="xrpl" amount={amount} link={link} />, "frame", { at: PATH, network: LAYOUT_XRPL }).container;

  it("draws a native amount as an amount, with no issuer", () => {
    const container = draw({ value: "1000", currency: "XRP" }, true);
    expect(container.textContent).toBe("1,000 XRP");
    expect(container.querySelector("a")).toBeNull();
  });

  it("draws a token with its issuer in the title and, with `link`, in the words 'issued by' as a link to the issuer", () => {
    const container = draw(token, true);
    expect(container.querySelector(".amt")!.getAttribute("title")).toBe(`524C555344000000000000000000000000000000 issued by ${TOKEN_ISSUER}`);
    expect(container.querySelector(".object-page__issuer")!.textContent).toBe("issued by rMxCKb…m5De");
    expect(within(container).getByRole("link", { name: "rMxCKb…m5De" }).getAttribute("href")).toBe(`/xrpl/account/${TOKEN_ISSUER}`);
  });

  it("draws a token without `link` with the issuer in the title only: no words and no link", () => {
    const container = draw(token, false);
    expect(container.querySelector(".amt")!.getAttribute("title")).toBe(`524C555344000000000000000000000000000000 issued by ${TOKEN_ISSUER}`);
    expect(container.querySelector(".object-page__issuer")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("draws an MPT as its raw units and the start of the issuance's ID, with no issuer, link or not", () => {
    const mpt: DisplayAmount = { mpt: { id: "0000012A95A7A415885FFF5E78A9B0A51C3EAF118ACD071A", units: "2500000" } };
    for (const link of [true, false]) {
      const container = draw(mpt, link);
      expect(container.textContent).toBe("2,500,000 units of MPT 0000012A…");
      expect(container.querySelector("a")).toBeNull();
      cleanup();
    }
  });
});

describe("LedgerObjectFrame's breadcrumb", () => {
  const data = () => checkPage({ origin: "index", answer: checkAnswerSample() }, { net: XRPL, serverState: stateOf(), names: NO_NAMES, back: [] });

  it("is the network, Accounts, the account of the row that names the holder, and the type: the Source of a check", () => {
    mountPage(
      <NamesProvider names={{}}>
        <CheckPage data={data()} />
      </NamesProvider>,
      "frame",
      { at: PATH, network: LAYOUT_XRPL },
    );
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("XRPL/Accounts/r9CaVb…DWyN/Check");
    expect(within(crumbs).getByRole("link", { name: "XRPL" }).getAttribute("href")).toBe("/xrpl");
    expect(crumbs.querySelector("[aria-current]")!.textContent).toBe("Check");
  });

  it("leaves the account out where the page has no row of it, and the crumbs still read", () => {
    const page = data();
    mountPage(
      <NamesProvider names={{}}>
        <CheckPage data={{ ...page, details: page.details.filter((row) => row.label !== "Source") }} />
      </NamesProvider>,
      "frame",
      { at: PATH, network: LAYOUT_XRPL },
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("XRPL/Accounts/Check");
  });
});
