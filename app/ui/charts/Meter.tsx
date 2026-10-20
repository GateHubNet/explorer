import { cx } from "../cx";
import { cellOf, shareOf } from "./cells";
import { percent, tooltipSide } from "./geometry";
import type { MeterData } from "./types";

/**
 * One ratio (spec 2.11): a track and a fill of `value` over `max`, 12 px high (6 px when `small`) with full radius, and, when the data has a
 * threshold, a tick of 2 px in `--fg` that reaches 5 px past the track with its label under it ("80% needed"). The label opens to the right of
 * its tick near the start of the track and to the left near its end (the tooltip's rule, `tooltipSide`), so that it stays inside.
 *
 * It is one image named by `data.label` ("84% of the UNL votes yes; 80% needed"): the view builder writes it, since the numbers are its. It has
 * no hover, because the row or card it sits in says the numbers. `decorative` is for a meter whose cell says its value in text (the markets
 * table's AMM share: a meter and "34%"): it is then `aria-hidden`, with no `role="img"` and no label, so that the value is read once.
 */
export function Meter({ data, small = false, decorative = false }: { data: MeterData; small?: boolean; decorative?: boolean }) {
  const { value, max, threshold } = data;
  // A threshold that is not a number has no tick, and no label that would point at nothing.
  const place = threshold && cellOf(threshold.value) ? shareOf(threshold.value, max) : null;
  return (
    <div
      className={cx("meter", small && "meter--small", place !== null && "meter--threshold")}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": data.label })}
    >
      <div className="meter__track">
        <span className="meter__fill" style={{ width: percent(shareOf(value, max)) }} />
        {place !== null && <span className="meter__tick" style={{ left: percent(place) }} />}
      </div>
      {place !== null && threshold && (
        <span className="meter__label" style={{ left: percent(place) }} data-side={tooltipSide(place)}>
          {threshold.label}
        </span>
      )}
    </div>
  );
}
