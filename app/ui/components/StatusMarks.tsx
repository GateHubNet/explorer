// The marks the validators and amendments pages draw their statuses with (spec 2.5), and the links of 2.8. Every status is an icon and a word,
// never colour alone; colour is only for `ok` and `bad`. A browser file: it takes its types from app/server (`import type`, erased) and its
// word from the domain files a browser file may import, never from validator-facts.ts, which value-imports a package of the Worker's.

import type { ReactNode } from "react";
import { Link } from "react-router";

import { statusWord } from "../../domain/amendments-params";
import type { AmendmentStatusView, DomainStatusKind, TextPart } from "../../server/validator-facts";
import { Countdown } from "./Countdown";
import { CrossIcon, InfoIcon } from "./icons";
import { Pill } from "./Pill";
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

// ---- Links (2.8) -------------------------------------------------------------------------------------------------------------------------------

/**
 * A link to another site: it opens a new tab, without handing the page over (`noopener noreferrer`), and says so with the icon and, to a
 * screen reader, "(opens in a new tab)". `nofollow` is for what anyone can point at (a validator's TOML file).
 */
export function ExternalLink({ href, nofollow, children }: { href: string; nofollow?: boolean; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel={nofollow ? "noopener noreferrer nofollow" : "noopener noreferrer"}>
      {children}
      <ExternalIcon className="extlink__icon" />
      <span className="sr"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * A sentence the builder wrote as parts: its strings, its internal links (React Router's `Link`, so a click navigates in the browser), its
 * external links (`ExternalLink`) and its countdowns (`Countdown`, which prints the part's `fallback` on the server).
 */
export function Parts({ parts }: { parts: readonly TextPart[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (typeof part === "string") return part;
        if ("countdown" in part) return <Countdown key={index} {...part.countdown} />;
        if (part.external !== undefined) {
          return (
            <ExternalLink key={index} href={part.href} nofollow={part.external === "nofollow"}>
              {part.mono ? <span className="mono">{part.text}</span> : part.text}
            </ExternalLink>
          );
        }
        return (
          <Link key={index} to={part.href} className={part.mono ? "mono" : undefined}>
            {part.text}
          </Link>
        );
      })}
    </>
  );
}

// ---- A validator's marks ----------------------------------------------------------------------------------------------------------------------

/**
 * What the check of a validator's domain found: "verified" in a list (the validator page spells it out, `page`: "Domain verified"), "not
 * verified", "not checked yet". A status this build does not know (a newer data API) reads "not verified", as the note under the name does.
 */
export function DomainStatus({ status, page }: { status: DomainStatusKind; page?: boolean }) {
  switch (status) {
    case "verified":
      return (
        <span className="st st--ok">
          <CheckCircleIcon />
          {page ? "Domain verified" : "verified"}
        </span>
      );
    case "pending":
      return (
        <span className="st st--quiet">
          <ClockIcon />
          not checked yet
        </span>
      );
    default:
      return (
        <span className="st st--quiet">
          <AlertCircleIcon />
          not verified
        </span>
      );
  }
}

/**
 * On a trusted list: the shield and "UNL". `listedBy`, the view's words for the lists that name the validator (`Listed by A and B`; empty when none does), follows in words a
 * screen reader reads after the tag's own, and is the `title` for the mouse (a title is not the accessible name).
 */
export function UnlTag({ listedBy }: { listedBy: string }) {
  const listed = listedBy !== "" ? listedBy : null;
  return (
    <span className="tag tag--icon" title={listed ?? undefined}>
      <ShieldIcon />
      UNL
      {listed !== null && <span className="sr">{` ${listed}`}</span>}
    </span>
  );
}

/** On the negative UNL: trusted, but not counted in the quorum for now. */
export function NegativeUnlTag() {
  return (
    <span className="tag tag--icon">
      <MinusCircleIcon />
      Negative UNL
    </span>
  );
}

/** Runs the newest release. */
export function LatestMark() {
  return (
    <span className="st st--ok">
      <LatestIcon />
      latest
    </span>
  );
}

/** Under an agreement figure that counts only part of its window. */
export function IncompleteMark() {
  return (
    <span className="st st--quiet">
      <InfoIcon size={12} />
      incomplete
    </span>
  );
}

// ---- Amendments --------------------------------------------------------------------------------------------------------------------------------

/** The builders' text for a share of nothing (validator-facts.ts's `DASH`, which a browser file does not import). */
const NO_SHARE = "—";

/**
 * An amendment's status: "Activated" (and the tag "retired" beside it for a retired amendment), "Activating, in 4 days" (on the server and
 * at hydration "Activating, expected Oct 23": a stored page holds no countdown), "Voting", "Obsolete", "Unknown". An activation with no moment
 * known (`at` is not a number) reads "Activating" alone, with no comma left hanging. **Growth** (E6): with `share`, a voting amendment's pill
 * says its share of yes, "Voting · 11.4% yes" (the validator page's amendment votes), and "Voting" alone where it has none.
 */
export function AmendmentStatusPill({ view, share }: { view: AmendmentStatusView; share?: boolean }) {
  switch (view.status) {
    case "enabled": {
      const activated = (
        <Pill tone="ok" icon={<CheckCircleIcon size={12} />}>
          {statusWord("enabled")}
        </Pill>
      );
      return view.retired ? (
        <span className="marks">
          {activated}
          <span className="tag">retired</span>
        </span>
      ) : (
        activated
      );
    }
    case "majority": {
      const { at, fallback } = view.activation;
      return (
        <Pill tone="info" icon={<ClockIcon />}>
          <span>
            {statusWord("majority")}
            {Number.isFinite(at) && (
              <>
                {", "}
                <Countdown at={at} fallback={fallback} past="at the next flag ledger" />
              </>
            )}
          </span>
        </Pill>
      );
    }
    case "voting":
      return (
        <Pill tone="neutral" icon={<BallotIcon />}>
          {share && view.share !== NO_SHARE ? `${statusWord("voting")} · ${view.share} yes` : statusWord("voting")}
        </Pill>
      );
    case "obsolete":
      return (
        <Pill tone="off" icon={<MinusCircleIcon />}>
          {statusWord("obsolete")}
        </Pill>
      );
    case "unknown":
      return (
        <Pill tone="off" icon={<QuestionIcon />}>
          {statusWord("unknown")}
        </Pill>
      );
  }
}

/** A validator's vote on an amendment: "Yes", "No", or "No recent vote" when it has cast none in the rounds the data API keeps. */
export function VotePill({ vote }: { vote: "yes" | "no" | "none" }) {
  switch (vote) {
    case "yes":
      return <Pill tone="ok">Yes</Pill>;
    case "no":
      return (
        <Pill tone="neutral" icon={<CrossIcon />}>
          No
        </Pill>
      );
    case "none":
      return (
        <Pill tone="off" icon={<DashIcon />}>
          No recent vote
        </Pill>
      );
  }
}

// ---- Validations and fees ----------------------------------------------------------------------------------------------------------------------

/**
 * Whether a validation's ledger hash is the one that was validated: "Matches", "Different hash" (with the validated ledger's short hash in
 * hidden text, when `validatedShort` is given), or "Not indexed yet" when the ledger is not in the data API yet.
 */
export function ValidationPill({ validated, validatedShort }: { validated: "matches" | "different" | "unknown"; validatedShort?: string }) {
  switch (validated) {
    case "matches":
      return <Pill tone="ok">Matches</Pill>;
    case "different":
      return (
        <Pill tone="bad">
          Different hash
          {validatedShort !== undefined && <span className="sr">{` validated ledger ${validatedShort}`}</span>}
        </Pill>
      );
    case "unknown":
      return (
        <Pill tone="neutral" icon={<ClockIcon />}>
          Not indexed yet
        </Pill>
      );
  }
}

/**
 * After a fee vote in the list: an arrow where it differs from the fee now (the eye reads it), and the words for a screen reader. Nothing for
 * a vote that is the same.
 */
export function FeeArrow({ against }: { against: "higher" | "lower" | "same" }) {
  if (against === "same") return null;
  return (
    <>
      <span className="fee-arrow" aria-hidden="true">
        {against === "higher" ? "↑" : "↓"}
      </span>
      <span className="sr">{`, ${against} than now`}</span>
    </>
  );
}

/** The validator page's fee vote against the fee now: "Higher", "Lower" or "Same", a pill with an arrow or an equals sign. */
export function FeePill({ against }: { against: "higher" | "lower" | "same" }) {
  switch (against) {
    case "higher":
      return (
        <Pill tone="neutral" icon={<ArrowUpIcon />}>
          Higher
        </Pill>
      );
    case "lower":
      return (
        <Pill tone="neutral" icon={<ArrowDownIcon />}>
          Lower
        </Pill>
      );
    case "same":
      return (
        <Pill tone="neutral" icon={<EqualsIcon />}>
          Same
        </Pill>
      );
  }
}
