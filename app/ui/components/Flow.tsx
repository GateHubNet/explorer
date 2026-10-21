import { Fragment } from "react";
import { Link } from "react-router";

import type { FlowStep } from "../../domain/describe";
import { poolLink } from "../../domain/pool-link";
import type { NetworkId } from "../../server/networks";
import { cx } from "../cx";
import { useFeatures } from "../use-network";
import { AccountLink } from "./AccountLink";
import { Amount } from "./Amount";
import { ArrowRightIcon } from "./icons";

/** An amount as a loss: the same value with a minus sign (a value that is one already stays so). */
const loss = (value: string): string => (value.startsWith("-") ? value : `-${value}`);

/**
 * Where the money went, as boxes joined by arrows: the sender with what it gave up, the pools or offers on the way with what
 * they paid out, the destination with what it got (`describe().flow`). Wraps on a narrow screen, the arrows then pointing down.
 * Take it out of the page for a transaction that moved nothing. While `AMM_PAGES` is on, a pool's label ("XRP/RLUSD AMM pool")
 * links its pool page (`poolLink`); its account link stays under it, as every step's does.
 */
export function Flow({ net, steps }: { net: NetworkId; steps: readonly FlowStep[] }) {
  const features = useFeatures();
  return (
    <div className="flow" role="group" aria-label="Flow of funds">
      {steps.map((step, index) => {
        const via = step.role !== "sender" && step.role !== "destination";
        const { amount } = step;
        return (
          <Fragment key={index}>
            {index > 0 && (
              <div className="flow__arrow" aria-hidden="true">
                <ArrowRightIcon size={22} />
              </div>
            )}
            <div className={cx("flow__node", via && "flow__node--via")}>
              <span className="flow__label">
                {step.role === "pool" && step.account !== "" && features.ammPages ? <Link to={poolLink(net, step.account, features)}>{step.label}</Link> : step.label}
              </span>
              {step.account !== "" && <AccountLink net={net} address={step.account} />}
              {amount && step.role === "sender" && <Amount value={loss(amount.value)} currency={amount.currency} issuer={amount.issuer} className="flow__amount" />}
              {amount && step.role === "destination" && <Amount signed value={amount.value} currency={amount.currency} issuer={amount.issuer} className="flow__amount" />}
              {amount && via && (
                <span className="flow__sub">
                  pays out <Amount value={amount.value} currency={amount.currency} issuer={amount.issuer} />
                </span>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
