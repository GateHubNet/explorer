import { Suspense } from "react";
import { Await } from "react-router";

import { ANALYTICS_PERIOD_LABELS, ANALYTICS_PERIODS, analyticsHref } from "../../domain/analytics-params";
import type { AnalyticsData, AnalyticsFrame, CardState } from "../../server/analytics-view";
import { SegmentedLinks } from "../components/SegmentedLinks";
import type { NetworkInfo } from "../networks";

/**
 * The filter row of the account's Analytics tab, under the tabs (spec 1.5): the period's segmented links, what the values are in, and the period
 * note. It is drawn with the account page, not with the lazy analytics view, so that it is there at once and costs the page little.
 *
 * The links are the view's canonical URLs (`analyticsHref`), each `rel="nofollow"` (spec 4: crawlers are kept off the analytics), and work before
 * the script runs; with it a choice is a client-side navigation that keeps the window where it is (`SegmentedLinks`).
 *
 * The period note is the page's one status for the view: "Loading analytics…" until the frame streams in, then the frame's note, in the same
 * element, so that assistive technology hears the change. A frame that failed or came too late leaves it empty: the view's own error says so.
 * Never fetches; imports only types from the server.
 */
export function AnalyticsFilters({
  network,
  address,
  analytics,
}: {
  network: NetworkInfo;
  address: string;
  analytics: Pick<AnalyticsData, "period" | "frame">;
}) {
  const { period, frame } = analytics;
  return (
    <div role="group" aria-label="Analytics filters" className="analytics-filters">
      <SegmentedLinks
        label="Period"
        links={ANALYTICS_PERIODS.map((id) => ({
          label: ANALYTICS_PERIOD_LABELS[id],
          href: analyticsHref(network.id, address, id),
          current: id === period,
          rel: "nofollow",
        }))}
      />
      <span className="analytics-filters__values">{`Values in ${network.native}: tokens at each day's DEX rate, and 0 without one`}</span>
      <p role="status" className="analytics-filters__note">
        <Suspense fallback="Loading analytics…">
          <Await resolve={frame} errorElement={null}>
            {(settled: CardState<AnalyticsFrame>) => (settled.state === "ok" ? settled.note : null)}
          </Await>
        </Suspense>
      </p>
    </div>
  );
}
