import { Fragment } from "react";

import type { IssuerPart } from "../../domain/names";
import { LabelMark } from "./NameMark";

/**
 * The issued sides of a list's row (the markets, the AMM pools; display names decision 12), " · " between them: each its code in mono, then its issuer, in mono unless it is a name,
 * then the label mark of an issuer GateHub labelled, as a link to the account would have it. Text, not a link: the row's one target is its pair.
 */
export function IssuerTexts({ parts }: { parts: readonly IssuerPart[] }) {
  return parts.map((part, at) => (
    <Fragment key={at}>
      {at > 0 && " · "}
      <span className="mono">{part.code}</span> <span className={part.name ? undefined : "mono"}>{part.issuer}</span>
      {part.labels.length > 0 && (
        <>
          {" "}
          <LabelMark labels={part.labels} />
        </>
      )}
    </Fragment>
  ));
}
