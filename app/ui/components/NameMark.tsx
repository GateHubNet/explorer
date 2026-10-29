// The marks beside an account's name (E9, spec 4.2): a shape and a word each, so that meaning is never colour alone. The icons are decorative
// (`aria-hidden`); the words are visually hidden (`.sr`), except the domain's tag, which is visible text.
//
// The two icons are made here and not in icons.tsx: that file is in the shell chunk every page loads (the header imports it), and these are drawn
// only by the pages that draw accounts. `AlertIcon` is the shell's already.

import { labelWords, type NameKind } from "../../domain/names";
import { AlertIcon, icon } from "./icons";

/** The board's seal with its check (AccountNames.dc.html), `--ok` when drawn by `.namemark--verified`. */
const SealCheckIcon = icon(
  <>
    <path d="M12 2.5l2.4 1.8 3 .1.9 2.8 2.4 1.9-.9 2.9.9 2.9-2.4 1.9-.9 2.8-3 .1L12 21.5l-2.4-1.8-3-.1-.9-2.8L3.3 15l.9-2.9-.9-2.9 2.4-1.9.9-2.8 3-.1z" />
    <path d="m8.5 12 2.4 2.4 4.6-4.8" />
  </>,
  { strokeWidth: 2.2, size: 14 },
);

/** The board's tag with its hole, `--muted` when drawn by `.namemark--account`. */
const TagIcon = icon(
  <>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </>,
  { strokeWidth: 2.2, size: 14 },
);

/**
 * How an account's name is known: a verified name has the seal and the hidden words "verified name", a name GateHub gave the tag and "named by
 * GateHub", and a name only the account's domain says the visible tag "not verified".
 */
export function NameMark({ kind }: { kind: NameKind }) {
  switch (kind) {
    case "verified":
      return (
        <span className="namemark namemark--verified">
          <SealCheckIcon />
          <span className="sr">verified name</span>
        </span>
      );
    case "account":
      return (
        <span className="namemark namemark--account">
          <TagIcon />
          <span className="sr">named by GateHub</span>
        </span>
      );
    case "domain":
      return <span className="unv">not verified</span>;
  }
}

/** That GateHub labelled the account: the alert icon, and the hidden words "labelled scam and spam by GateHub". Nothing for no label. */
export function LabelMark({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="labelmark">
      <AlertIcon size={14} />
      <span className="sr">{`labelled ${labelWords(labels)} by GateHub`}</span>
    </span>
  );
}

/**
 * The marks of a named account after its label or its name (E9, spec 4.3): how its name is known, then its labels, each after a space so that the words read on ("Northpeak
 * Treasury verified name labelled scam by GateHub"). The chart kit's list and its table view both draw an item's `mark` with it. Nothing for no `mark`, or one of nothing.
 */
export function Marks({ mark }: { mark: { kind?: NameKind; labels: readonly string[] } | undefined }) {
  if (!mark) return null;
  return (
    <>
      {mark.kind !== undefined && (
        <>
          {" "}
          <NameMark kind={mark.kind} />
        </>
      )}
      {mark.labels.length > 0 && (
        <>
          {" "}
          <LabelMark labels={mark.labels} />
        </>
      )}
    </>
  );
}
