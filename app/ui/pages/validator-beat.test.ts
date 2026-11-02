import { describe, expect, it } from "vitest";

import { amendmentsSample, SAMPLE_KEYS, summarySample, validationsSample, validatorDetailSample } from "../../../test/support/d1-samples";
import { NAMES_OFF, NO_NAMES, type NamesPart, type NameView } from "../../domain/names";
import type { Loaded } from "../../server/account-view";
import { validatorPage } from "../../server/validator-view";
import { NO_FEATURES } from "../features";
import type { NetworkInfo } from "../networks";
import { mergeValidatorBeat, VALIDATOR_PARTS, type ValidatorLoaderData } from "./validator-beat";

// What the validator page shows for a beat of the live page (the route's `createLiveOnScreen` merge): the beat's answer, with every part that failed in the beat and is loaded on screen
// kept (`keepLoaded` over `VALIDATOR_PARTS`: the names part among them, display names spec 3.4), and the names of accounts that left the page kept for the ones that stay
// (`mergeNames`). Fictional names.

const FIRST = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const SECOND = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const THIRD = "rLUEXYuLiQptky37CqLcm9USQpPiz5rkpD";

const verified = (text: string, domain: string): NameView => ({ name: { text, kind: "verified" }, domain, labels: [] });
const NORTHPEAK = verified("Northpeak Treasury", "northpeak.example");
const TIDEWATER = verified("Tidewater Reserve", "tidewater.example");
const HARBORLINE: NameView = { name: { text: "Harborline Exchange", kind: "account" }, network: "hot wallet", labels: ["advisory"] };

const XRPL: NetworkInfo = { id: "xrpl", kind: "mainnet", name: "XRPL", label: "XRPL mainnet", longName: "the XRP Ledger", dexName: "the XRP Ledger DEX", native: "XRP", software: "rippled" };
const ok = <T>(value: T): Loaded<T> => ({ state: "ok", value });
const FAILED: Loaded<never> = { state: "failed" };

const part = (state: NamesPart["state"], map: NamesPart["map"] = {}): NamesPart => ({ state, map });

/** A live page at ledger `index`, made by build `build`, with the names part `names`; the parts that can fail are loaded unless `over` says otherwise. */
function live(index: number, names: NamesPart, over: Partial<Parameters<typeof validatorPage>[0]> = {}, build = "abc1234"): ValidatorLoaderData {
  return {
    ...validatorPage({
      network: XRPL,
      validator: validatorDetailSample({ validation_public_key: SAMPLE_KEYS[0] }),
      recent: ok(validationsSample()),
      summary: ok(summarySample()),
      amendments: ok(amendmentsSample()),
      anchor: { lastValidated: index, closeTime: 1792252452 + index },
      features: NO_FEATURES,
      ...over,
    }),
    names,
    anchor: { lastValidated: index, closeTime: 1792252452 + index },
    build,
  };
}

describe("VALIDATOR_PARTS", () => {
  it("is the parts of the page that can fail on their own, and the names", () => {
    expect([...VALIDATOR_PARTS]).toEqual(["recent", "summary", "amendments", "names"]);
  });
});

describe("mergeValidatorBeat", () => {
  it("keeps the names part that is shown when the beat's names call failed: ok, with the earlier map, and the rest from the beat", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE }));
    const next = live(101, part("failed"));

    const merged = mergeValidatorBeat(next, shown);

    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE });
    // The rest is the beat's: the anchor is its ledger's.
    expect(merged.anchor.lastValidated).toBe(101);
  });

  it("keeps the earlier map, not the beat's half answer, when the call failed for some of the addresses", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }));
    const next = live(101, part("failed", { [SECOND]: TIDEWATER }));

    const merged = mergeValidatorBeat(next, shown);

    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK });
  });

  it("merges the maps when the beat's names arrived: the beat's entry wins, the accounts that left keep theirs", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK, [SECOND]: HARBORLINE }));
    const updated = verified("Northpeak Custody", "northpeak.example");
    const next = live(101, part("ok", { [FIRST]: updated, [THIRD]: TIDEWATER }));

    const merged = mergeValidatorBeat(next, shown);

    expect(merged.names.state).toBe("ok");
    expect(merged.names.map).toEqual({ [FIRST]: updated, [SECOND]: HARBORLINE, [THIRD]: TIDEWATER });
  });

  it("stays failed when the beat failed and the page shows no names either: there is nothing to keep, and the half answer is not thrown away", () => {
    const merged = mergeValidatorBeat(live(101, part("failed", { [SECOND]: TIDEWATER })), live(100, part("failed")));
    expect(merged.names.state).toBe("failed");
    expect(merged.names.map).toEqual({ [SECOND]: TIDEWATER });
  });

  it("takes the names of the beat after a beat that failed", () => {
    const merged = mergeValidatorBeat(live(101, part("ok", { [FIRST]: NORTHPEAK })), live(100, part("failed")));
    expect(merged.names).toEqual({ state: "ok", map: { [FIRST]: NORTHPEAK } });
  });

  it("stays off when the beat has the switch off: no map of the page before is carried over", () => {
    const merged = mergeValidatorBeat(live(101, NAMES_OFF), live(100, part("ok", { [FIRST]: NORTHPEAK })));
    expect(merged.names).toEqual({ state: "off", map: {} });
    expect(merged.names).toBe(NAMES_OFF);
  });

  it("takes the beat's names as they are when nothing was shown yet to keep", () => {
    expect(mergeValidatorBeat(live(101, part("ok", { [FIRST]: NORTHPEAK })), live(100, NO_NAMES)).names).toEqual({ state: "ok", map: { [FIRST]: NORTHPEAK } });
  });

  it("keeps the three cards that failed in the beat and are loaded on screen, as before names, and the names with them", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }));
    const next = live(101, part("failed"), { recent: FAILED, summary: FAILED, amendments: FAILED });

    const merged = mergeValidatorBeat(next, shown);

    expect(merged.recent).toBe(shown.recent);
    expect(merged.summary).toBe(shown.summary);
    expect(merged.amendments).toBe(shown.amendments);
    expect(merged.names.map).toEqual({ [FIRST]: NORTHPEAK });
  });

  it("changes nothing else of the beat: the answer is the beat's but for the parts it keeps and the names", () => {
    const shown = live(100, part("ok", { [FIRST]: NORTHPEAK }));
    const next = live(101, part("failed"));
    const { names: _kept, ...rest } = mergeValidatorBeat(next, shown);
    const { names: _failed, ...expected } = next;
    expect(rest).toEqual(expected);
  });
});
