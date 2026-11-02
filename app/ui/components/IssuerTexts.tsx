import { Fragment } from "react";

import type { IssuerPart } from "../../domain/names";
import { LabelMark } from "./NameMark";

/**
 * The issued sides of a list's row (the markets, the AMM pools; display names decision 12), " · " between them: each its code in mono, then its issuer, in mono unless it is a name,
 * then the label mark of an issuer GateHub labelled, as a link to the account would have it. The line wraps and is never cut (pages.css), so that the mark stays in sight;
 * a labelled issuer and its mark are one unit that does not break (`.issued-marked`): a labelled issuer is a short address, never a name, so the unit is short. Text, not a
 * link: the row's one target is its pair.
 */
export function IssuerTexts({ parts }: { parts: readonly IssuerPart[] }) {
  return parts.map((part, at) => (
    <Fragment key={at}>
      {at > 0 && " · "}
      <span className="mono">{part.code}</span>{" "}
      {part.labels.length > 0 ? (
        <span className="issued-marked">
          <span className={part.name ? undefined : "mono"}>{part.issuer}</span> <LabelMark labels={part.labels} />
        </span>
      ) : (
        <span className={part.name ? undefined : "mono"}>{part.issuer}</span>
      )}
    </Fragment>
  ));
}
