import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverThenHydrated } from "../../../test/support/hydrate";
import type { AmendmentStatusView, DomainStatusKind, TextPart } from "../../server/validator-facts";
import { CheckIcon, CrossIcon, InfoIcon } from "./icons";
import {
  AmendmentStatusPill,
  DomainStatus,
  ExternalLink,
  FeeArrow,
  FeePill,
  IncompleteMark,
  LatestMark,
  NegativeUnlTag,
  Parts,
  UnlTag,
  ValidationPill,
  VotePill,
} from "./StatusMarks";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BallotIcon,
  CheckCircleIcon,
  ClockIcon,
  DashIcon,
  EqualsIcon,
  ExternalIcon,
  LatestIcon,
  MinusCircleIcon,
  QuestionIcon,
  ShieldIcon,
} from "./status-icons";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The drawing inside an icon's `<svg>`: what tells one icon from another (the size and the stroke are the place's, not the icon's). */
function drawing(icon: ReactElement): string {
  const { container, unmount } = render(icon);
  const html = container.querySelector("svg")!.innerHTML;
  unmount();
  return html;
}
const drawnIn = (element: Element) => element.querySelector("svg")!.innerHTML;

/** What a browser shows of HTML the Worker printed. */
function textOfHtml(html: string): string {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.textContent ?? "";
}

/** The page's links need a router around them, as they have in the app. */
function inRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: ["/xrpl/validators"] });
  return render(<RouterProvider router={router} />);
}

/** Moves the browser's clock to `seconds` (unix). */
function clockAt(seconds: number) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(seconds * 1000));
}

// 2026-10-23 09:34:00 UTC, unix seconds: the moment a majority's amendment activates.
const ACTIVATES = Date.UTC(2026, 9, 23, 9, 34, 0) / 1000;
const DAY = 86_400;

const pillOf = (text: string) => screen.getByText(text).closest(".pill")!;

describe("DomainStatus", () => {
  const DOMAIN_CASES: ReadonlyArray<{ status: DomainStatusKind; list: string; page: string; tone: string; icon: ReactElement }> = [
    { status: "verified", list: "verified", page: "Domain verified", tone: "st--ok", icon: <CheckCircleIcon /> },
    { status: "unverified", list: "not verified", page: "not verified", tone: "st--quiet", icon: <AlertCircleIcon /> },
    { status: "pending", list: "not checked yet", page: "not checked yet", tone: "st--quiet", icon: <ClockIcon /> },
  ];

  it.each(DOMAIN_CASES)("DomainStatus $status draws its icon and words", ({ status, list, page, tone, icon }) => {
    const { container, rerender } = render(<DomainStatus status={status} />);
    const mark = container.querySelector(".st")!;
    expect(mark.textContent).toBe(list);
    expect(mark.classList.contains(tone)).toBe(true);
    expect(mark.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(drawnIn(mark)).toBe(drawing(icon));

    // The validator page spells the verified one out; the others say the same there.
    rerender(<DomainStatus status={status} page />);
    expect(container.querySelector(".st")!.textContent).toBe(page);
  });

  it("never marks the three states by colour alone: each has an icon of its own", () => {
    const drawings = DOMAIN_CASES.map(({ status }) => {
      const { container, unmount } = render(<DomainStatus status={status} />);
      const html = drawnIn(container);
      unmount();
      return html;
    });
    expect(new Set(drawings).size).toBe(3);
  });

  it("reads a status it does not know (a newer data API) as not verified, as the note under the name does", () => {
    const { container } = render(<DomainStatus status={"revoked" as DomainStatusKind} />);
    expect(container.textContent).toBe("not verified");
  });
});

describe("UnlTag", () => {
  const PUBLISHERS = ["vl.ripple.com", "unl.xrplf.org"];

  it("names the UNL tag by its word and publishers, not by its title", () => {
    inRouter(
      <a href="/xrpl/validators/x">
        <UnlTag publishers={PUBLISHERS} />
      </a>,
    );
    // A link takes its name from what it holds: the tag's words, and the hidden ones after them. The `title` (for the mouse) is not part of it.
    const link = screen.getByRole("link", { name: "UNL Listed by vl.ripple.com and unl.xrplf.org" });
    const tag = link.querySelector(".tag")!;
    expect(tag.getAttribute("title")).toBe("Listed by vl.ripple.com and unl.xrplf.org");
    expect(tag.textContent).toBe("UNL Listed by vl.ripple.com and unl.xrplf.org");
    expect(tag.querySelector(".sr")!.textContent).toBe(" Listed by vl.ripple.com and unl.xrplf.org");
    tag.removeAttribute("title");
    expect(screen.getByRole("link", { name: "UNL Listed by vl.ripple.com and unl.xrplf.org" })).toBe(link);
  });

  it("draws the shield beside the word, as a tag", () => {
    const { container } = render(<UnlTag publishers={["unl.xrplf.org"]} />);
    const tag = container.querySelector(".tag")!;
    expect(drawnIn(tag)).toBe(drawing(<ShieldIcon />));
    expect(tag.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(tag.textContent).toBe("UNL Listed by unl.xrplf.org");
  });

  it("names three publishers as a sentence does", () => {
    const { container } = render(<UnlTag publishers={["a.example", "b.example", "c.example"]} />);
    expect(container.textContent).toBe("UNL Listed by a.example, b.example and c.example");
  });

  it("says only UNL when it has no publisher to name (no 'Listed by' with nothing after it)", () => {
    const { container } = render(<UnlTag publishers={[]} />);
    expect(container.textContent).toBe("UNL");
    expect(container.querySelector(".tag")!.hasAttribute("title")).toBe(false);
  });
});

describe("NegativeUnlTag, LatestMark and IncompleteMark", () => {
  it("NegativeUnlTag is a tag with the minus-circle and the words", () => {
    const { container } = render(<NegativeUnlTag />);
    const tag = container.querySelector(".tag")!;
    expect(tag.textContent).toBe("Negative UNL");
    expect(drawnIn(tag)).toBe(drawing(<MinusCircleIcon />));
    expect(tag.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("LatestMark is the latest icon and 'latest', in the ok colour", () => {
    const { container } = render(<LatestMark />);
    const mark = container.querySelector(".st")!;
    expect(mark.textContent).toBe("latest");
    expect(mark.classList.contains("st--ok")).toBe(true);
    expect(drawnIn(mark)).toBe(drawing(<LatestIcon />));
    expect(mark.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("IncompleteMark is the info icon and 'incomplete', quiet", () => {
    const { container } = render(<IncompleteMark />);
    const mark = container.querySelector(".st")!;
    expect(mark.textContent).toBe("incomplete");
    expect(mark.classList.contains("st--quiet")).toBe(true);
    expect(drawnIn(mark)).toBe(drawing(<InfoIcon />));
    expect(mark.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("AmendmentStatusPill", () => {
  const AMENDMENT_VIEWS: ReadonlyArray<{ view: AmendmentStatusView; word: string; tone: string; icon: ReactElement }> = [
    { view: { status: "enabled", retired: false }, word: "Activated", tone: "pill--ok", icon: <CheckCircleIcon /> },
    { view: { status: "voting", share: "11.4%" }, word: "Voting", tone: "pill--neutral", icon: <BallotIcon /> },
    { view: { status: "obsolete" }, word: "Obsolete", tone: "pill--off", icon: <MinusCircleIcon /> },
    { view: { status: "unknown", share: "0.0%" }, word: "Unknown", tone: "pill--off", icon: <QuestionIcon /> },
  ];

  it.each(AMENDMENT_VIEWS)("AmendmentStatusPill $view.status", ({ view, word, tone, icon }) => {
    const { container } = render(<AmendmentStatusPill view={view} />);
    const pill = container.querySelector(".pill")!;
    expect(pill.textContent).toBe(word);
    expect(pill.classList.contains(tone)).toBe(true);
    expect(pill.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(drawnIn(pill)).toBe(drawing(icon));
    expect(container.querySelector(".tag")).toBeNull();
  });

  it("adds the 'retired' tag to an activated amendment that is retired, and only to that", () => {
    const { container } = render(<AmendmentStatusPill view={{ status: "enabled", retired: true }} />);
    expect(container.querySelector(".pill")!.textContent).toBe("Activated");
    expect(container.querySelector(".tag")!.textContent).toBe("retired");
    // The tag is beside the pill, not inside it.
    expect(container.querySelector(".pill .tag")).toBeNull();
    cleanup();
    for (const view of [{ status: "voting", share: "—" }, { status: "obsolete" }] as const) {
      const { container: other, unmount } = render(<AmendmentStatusPill view={view} />);
      expect(other.querySelector(".tag")).toBeNull();
      unmount();
    }
  });

  it("draws a majority as the accent wash with the clock and 'Activating', then the time", () => {
    const { container } = render(<AmendmentStatusPill view={{ status: "majority", activation: { at: ACTIVATES, fallback: "expected Oct 23" } }} />);
    const pill = container.querySelector(".pill")!;
    expect(pill.classList.contains("pill--info")).toBe(true);
    expect(drawnIn(pill)).toBe(drawing(<ClockIcon />));
    expect(pill.querySelector("time")).not.toBeNull();
  });

  it("prints 'Activating, expected Oct 23' on the server and 'Activating, in 4 days' in the browser", async () => {
    clockAt(ACTIVATES - 4 * DAY);
    const view: AmendmentStatusView = { status: "majority", activation: { at: ACTIVATES, fallback: "expected Oct 23" } };

    // The stored HTML: the absolute day, nothing that counts.
    expect(textOfHtml(renderToStaticMarkup(<AmendmentStatusPill view={view} />))).toBe("Activating, expected Oct 23");

    // The browser takes it over without a mismatch, and counts from the first tick after hydration.
    const { html, container, errors } = await serverThenHydrated(<AmendmentStatusPill view={view} />);
    expect(textOfHtml(html)).toBe("Activating, expected Oct 23");
    expect(container.textContent).toBe("Activating, in 4 days");
    expect(errors).toEqual([]);
  });

  it("says 'at the next flag ledger' once the moment has passed, and never claims an estimate (no ~)", () => {
    clockAt(ACTIVATES - 4 * DAY);
    const { container, unmount } = render(<AmendmentStatusPill view={{ status: "majority", activation: { at: ACTIVATES, fallback: "expected Oct 23" } }} />);
    expect(container.textContent).toBe("Activating, in 4 days");
    unmount();
    clockAt(ACTIVATES + 60);
    const later = render(<AmendmentStatusPill view={{ status: "majority", activation: { at: ACTIVATES, fallback: "expected Oct 23" } }} />);
    expect(later.container.textContent).toBe("Activating, at the next flag ledger");
  });

  it("reads 'Activating' with no dangling comma when no moment is known (the server, the first render and the browser)", async () => {
    clockAt(ACTIVATES - 4 * DAY);
    const view: AmendmentStatusView = { status: "majority", activation: { at: Number.NaN, fallback: "" } };
    expect(textOfHtml(renderToStaticMarkup(<AmendmentStatusPill view={view} />))).toBe("Activating");
    const { html, container, errors } = await serverThenHydrated(<AmendmentStatusPill view={view} />);
    expect(textOfHtml(html)).toBe("Activating");
    expect(container.textContent).toBe("Activating");
    expect(container.querySelector("time")).toBeNull();
    expect(errors).toEqual([]);
  });
});

describe("VotePill", () => {
  it.each([
    ["yes", "Yes", "pill--ok", <CheckIcon key="i" />],
    ["no", "No", "pill--neutral", <CrossIcon key="i" />],
    ["none", "No recent vote", "pill--off", <DashIcon key="i" />],
  ] as const)("VotePill %s says %s", (vote, word, tone, icon) => {
    const { container } = render(<VotePill vote={vote} />);
    const pill = container.querySelector(".pill")!;
    expect(pill.textContent).toBe(word);
    expect(pill.classList.contains(tone)).toBe(true);
    expect(pill.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(drawnIn(pill)).toBe(drawing(icon));
  });
});

describe("ValidationPill", () => {
  it.each([
    ["matches", "Matches", "pill--ok"],
    ["different", "Different hash", "pill--bad"],
    ["unknown", "Not indexed yet", "pill--neutral"],
  ] as const)("ValidationPill %s says %s", (validated, word, tone) => {
    const { container } = render(<ValidationPill validated={validated} />);
    const pill = container.querySelector(".pill")!;
    expect(pill.textContent).toBe(word);
    expect(pill.classList.contains(tone)).toBe(true);
    // An icon in each, so that no state is told by its colour alone.
    expect(pill.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives 'Different hash' the validated ledger's short hash as hidden text, and the others none", () => {
    const { container } = render(<ValidationPill validated="different" validatedShort="4F2A91…B1C3" />);
    expect(container.querySelector(".pill")!.textContent).toBe("Different hash validated ledger 4F2A91…B1C3");
    const hidden = container.querySelector(".sr")!;
    expect(hidden.textContent).toBe(" validated ledger 4F2A91…B1C3");
    cleanup();

    const plain = render(<ValidationPill validated="different" />);
    expect(plain.container.textContent).toBe("Different hash");
    expect(plain.container.querySelector(".sr")).toBeNull();
    cleanup();

    for (const validated of ["matches", "unknown"] as const) {
      const other = render(<ValidationPill validated={validated} validatedShort="4F2A91…B1C3" />);
      expect(other.container.querySelector(".sr")).toBeNull();
      other.unmount();
    }
  });
});

describe("FeeArrow and FeePill", () => {
  it("FeeArrow says higher and lower in words (the arrow is for the eye) and draws nothing for the same", () => {
    const up = render(<FeeArrow against="higher" />);
    const arrow = up.container.querySelector('[aria-hidden="true"]')!;
    expect(arrow.textContent).toBe("↑");
    expect(up.container.querySelector(".sr")!.textContent).toBe(", higher than now");
    expect(up.container.textContent).toBe("↑, higher than now");
    up.unmount();

    const down = render(<FeeArrow against="lower" />);
    expect(down.container.querySelector('[aria-hidden="true"]')!.textContent).toBe("↓");
    expect(down.container.querySelector(".sr")!.textContent).toBe(", lower than now");
    down.unmount();

    const same = render(<FeeArrow against="same" />);
    expect(same.container.innerHTML).toBe("");
  });

  it("FeeArrow, read after a value, reads '10 drops, higher than now'", () => {
    const { container } = render(
      <span>
        10 drops
        <FeeArrow against="higher" />
      </span>,
    );
    // What a screen reader gets: the arrow is hidden from it.
    const spoken = [...container.firstElementChild!.childNodes]
      .filter((node) => !(node instanceof Element && node.getAttribute("aria-hidden") === "true"))
      .map((node) => node.textContent)
      .join("");
    expect(spoken).toBe("10 drops, higher than now");
  });

  it.each([
    ["higher", "Higher", <ArrowUpIcon key="i" />],
    ["lower", "Lower", <ArrowDownIcon key="i" />],
    ["same", "Same", <EqualsIcon key="i" />],
  ] as const)("FeePill %s says %s with its icon", (against, word, icon) => {
    const { container } = render(<FeePill against={against} />);
    const pill = container.querySelector(".pill")!;
    expect(pill.textContent).toBe(word);
    expect(pill.classList.contains("pill--neutral")).toBe(true);
    expect(pill.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(drawnIn(pill)).toBe(drawing(icon));
  });
});

describe("ExternalLink", () => {
  it("opens a new tab safely and says so", () => {
    render(<ExternalLink href="https://github.com/XRPLF/XRPL-Standards/discussions/90">XLS-30</ExternalLink>);
    const link = screen.getByRole("link", { name: "XLS-30 (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://github.com/XRPLF/XRPL-Standards/discussions/90");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector(".sr")!.textContent).toBe(" (opens in a new tab)");
    const icon = link.querySelector("svg")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(drawnIn(link)).toBe(drawing(<ExternalIcon />));
  });

  it("adds nofollow for a link anyone can point at (a TOML file)", () => {
    render(
      <ExternalLink href="https://a.example/.well-known/xrp-ledger.toml" nofollow>
        xrp-ledger.toml
      </ExternalLink>,
    );
    expect(screen.getByRole("link").getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(screen.getByRole("link").getAttribute("target")).toBe("_blank");
  });
});

describe("Parts", () => {
  const PARTS: readonly TextPart[] = [
    "The ",
    { text: "xrp-ledger.toml", href: "https://a.example/.well-known/xrp-ledger.toml", external: "nofollow" },
    " at a.example lists this key; see ",
    { text: "XLS-30", href: "https://github.com/XRPLF/XRPL-Standards/discussions/90", external: "plain" },
    " and ledger ",
    { text: "#107,748,352", href: "/xrpl/ledger/107748352", mono: true },
    ", due ",
    { countdown: { at: ACTIVATES, fallback: "expected Oct 23", past: "due now", approx: true } },
    ".",
  ];

  it("draws strings, links and countdowns", () => {
    clockAt(ACTIVATES - 4 * DAY);
    const { container } = inRouter(<Parts parts={PARTS} />);
    expect(container.textContent).toBe(
      "The xrp-ledger.toml (opens in a new tab) at a.example lists this key; see XLS-30 (opens in a new tab) and ledger #107,748,352, due in ~4 days.",
    );

    // An internal link is a router link: no new tab, no rel. `mono` is its class.
    const internal = screen.getByRole("link", { name: "#107,748,352" });
    expect(internal.getAttribute("href")).toBe("/xrpl/ledger/107748352");
    expect(internal.hasAttribute("target")).toBe(false);
    expect(internal.hasAttribute("rel")).toBe(false);
    expect(internal.classList.contains("mono")).toBe(true);

    // An external one goes through ExternalLink: `nofollow` where the part says so, and only there.
    expect(screen.getByRole("link", { name: "xrp-ledger.toml (opens in a new tab)" }).getAttribute("rel")).toBe("noopener noreferrer nofollow");
    const plain = screen.getByRole("link", { name: "XLS-30 (opens in a new tab)" });
    expect(plain.getAttribute("rel")).toBe("noopener noreferrer");
    expect(plain.getAttribute("target")).toBe("_blank");

    // The countdown is Countdown's: a <time> with the absolute moment.
    const time = container.querySelector("time")!;
    expect(time.textContent).toBe("in ~4 days");
    expect(time.getAttribute("datetime")).toBe("2026-10-23T09:34:00.000Z");
  });

  it("prints the countdown's fallback on the server", () => {
    const html = renderToStaticMarkup(
      <Parts parts={["Due ", { countdown: { at: ACTIVATES, fallback: "expected Oct 23", past: "due now" } }]} />,
    );
    expect(textOfHtml(html)).toBe("Due expected Oct 23");
  });

  it("draws a monospaced external link in mono, and nothing for no parts", () => {
    const { container } = render(<Parts parts={[{ text: "1717BD…A20A", href: "https://a.example/x", external: "plain", mono: true }]} />);
    const link = within(container).getByRole("link");
    expect(link.querySelector(".mono")!.textContent).toBe("1717BD…A20A");
    cleanup();
    expect(render(<Parts parts={[]} />).container.innerHTML).toBe("");
  });
});
