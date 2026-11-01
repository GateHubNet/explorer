// The data API's answers for the supply page (E12 spec 11): D7's two routes, `GET /v2/network/supply` and, on Xahau, `GET /v2/network/supply/minted`. D7 computes the snapshot hourly from the
// whole history (the escrows, the AMM pools, the account states, the fees and the mints), so nothing can be recorded from a few ledgers: the answers are synthetic, and `pnpm fixtures:sync` writes
// them (`generate()` in http-fixtures.ts calls `supplyFixtures(net, last, snapshot)` for each network, after `validatorsFixtures`, and writes them with `builtFixtureText`: the keys stay in the
// order of D7's reference, which `fixtureText` would sort away). test/fixtures/PROVENANCE.md, "Synthetic supply", says what they follow.
//
// They follow data-api `feat/explorer-data-2` at 31e97efaa1a6e098435b666e8893c79a0c4bee66, docs/api-reference.md `GET /v2/network/supply` and `GET /v2/network/supply/minted`, and use the
// figures and coverages of its built examples (plan Ruling C11): not those of D7's design spec §5.1, whose coverages "cannot occur together". The figures of the snapshot are the examples', as
// constants; the rules that tie them (`circulating` = `total` less `escrowed`, `minted.amount` the sum of its sources, `reserves.amount` = `accounts` × `base` + `owner_count` × `increment`,
// the XRP Ledger's `burned` = 100 billion less `total`) are kept by test/unit/supply-fixtures.test.ts, with BigNumber, not by this file.
//
//   - XRPL: the snapshot is the recorded ledger 107,720,688, about 50 minutes before `last_validated` (so it is not stale), written 107 s after its close. Every part but `minted`;
//     the history starts at ledger 28,685,313, the escrows, the AMM pools and the circulating supply are complete, the reserves (which start at the first ledger) are not.
//   - Xahau: the snapshot is the newest recorded ledger, written 29 s after its close. `minted`, no `amm`; the history starts at ledger 1 and every part is complete. Its minted days are the
//     90 of the network page's window (`windowOf(T, "90d")`, T the UTC day of the newest ledger's close), seeded with `mulberry32(seedOf("xahau", "supply/minted"))`.
//   - The XRP Ledger mints nothing, its page does not ask for the days (spec 3.2), so it has no minted file.
// Only integer arithmetic and the four IEEE operations are used on the numbers, BigNumber for the decimals, so every Node writes the same bytes.

import BigNumber from "bignumber.js";

import { utcDayOf, windowOf } from "../app/domain/window";
import type { Coverage, LastValidated, MintedPage, MintedRow, NetworkSupply } from "../app/server/api-types";
import type { NetworkName } from "../test/support/upstream-core";
import type { FixtureFile } from "./network-fixtures";
import { mulberry32, seedOf } from "./synthetic";

/** The lists whose rows the files write one to a line (`builtFixtureText`'s `rowLists`): the days of the minted page. */
export const SUPPLY_ROW_LISTS: readonly string[] = ["rows"];

/** Seconds after the close of the snapshot's ledger that its row was written: a figure of D7's examples (XRPL 21:00:00 → 21:01:47, Xahau 21:00:02 → 21:00:31). */
const COMPUTED_AFTER = { xrpl: 107, xahau: 29 } as const;

/** The ledger the XRP Ledger's history starts at in D7's example: the one Escrow was enabled in. */
const XRPL_FROM = 28_685_313;

const COMPLETE = (from: number): Coverage => ({ from_ledger_index: from, complete: true });

/** `YYYY-MM-DDTHH:mm:ssZ` of a time `seconds` after `time`. */
function plusSeconds(time: string, seconds: number): string {
  return new Date(Date.parse(time) + seconds * 1000).toISOString().replace(".000Z", "Z");
}

/** D7's XRP Ledger example, at the snapshot's ledger: every figure and count of it, the coverages of its built version (C11). */
function xrplSupply(snapshot: { ledger_index: number; close_time: string }): NetworkSupply {
  return {
    result: "success",
    ledger_index: snapshot.ledger_index,
    close_time: snapshot.close_time,
    computed_at: plusSeconds(snapshot.close_time, COMPUTED_AFTER.xrpl),
    currency: "XRP",
    total: "99985312374.716318",
    burned: { amount: "14687625.283682" },
    escrowed: { amount: "35212847105.402318", escrows: 12879, coverage: COMPLETE(XRPL_FROM) },
    circulating: { amount: "64772465269.314", coverage: COMPLETE(XRPL_FROM) },
    amm: { amount: "46218377.402915", pools: 14594, coverage: COMPLETE(XRPL_FROM) },
    reserves: { amount: "9810004", accounts: 6410280, owner_count: 16998620, base: "1", increment: "0.2", coverage: { from_ledger_index: XRPL_FROM, complete: false } },
  };
}

/** D7's Xahau example, at the snapshot's ledger. */
function xahauSupply(snapshot: { ledger_index: number; close_time: string }): NetworkSupply {
  return {
    result: "success",
    ledger_index: snapshot.ledger_index,
    close_time: snapshot.close_time,
    computed_at: plusSeconds(snapshot.close_time, COMPUTED_AFTER.xahau),
    currency: "XAH",
    total: "613401782.117306",
    burned: { amount: "2318.640227", coverage: COMPLETE(1) },
    minted: { amount: "49425551.616207", rewards: "41203318.512207", import: "8102233.104", genesis_mint: "120000", coverage: COMPLETE(1) },
    escrowed: { amount: "18406227.318004", escrows: 2140, coverage: COMPLETE(1) },
    circulating: { amount: "594995554.799302", coverage: COMPLETE(1) },
    reserves: { amount: "268973.2", accounts: 186412, owner_count: 412806, base: "1", increment: "0.2", coverage: COMPLETE(1) },
  };
}

// ---- The minted days -------------------------------------------------------------------------------------------------

/** The one day with a `GenesisMint` that is no reward, and what it minted (whole XAH). */
const GENESIS_DAY = "2026-09-14";
const GENESIS_MINT = 40_000;
/** Micro-units (millionths of a XAH) of a reward a day (25,000 to 35,000 XAH) and of an Import (500 to 8,000 XAH, on four days in five). */
const REWARD_MIN = 25_000_000_000;
const REWARD_SPAN = 10_000_000_000;
const IMPORT_MIN = 500_000_000;
const IMPORT_SPAN = 7_500_000_000;
const IMPORT_DAYS = 0.8;

/** Whole units of a number of micro-units, as D7 writes an amount: exact decimal text, trailing zeros dropped. */
const units = (micro: number | BigNumber): string => new BigNumber(micro).shiftedBy(-6).toFixed();

/**
 * The 90 UTC days of the network page's window, oldest first, one row each: rewards every day, imports on about four days in five, one `GenesisMint` day, and the running day (the last) at about
 * a third of a day's mint, summed so far (the plan's figure; D7's newest day is "the running one, summed so far"). Each day draws its three numbers whether it uses them or not, so a day's
 * amounts depend on its place in the window and nothing else. `amount` is the exact sum of the three sources.
 */
function mintedDays(net: NetworkName, today: string): MintedRow[] {
  const next = mulberry32(seedOf(net, "supply/minted"));
  return windowOf(today, "90d").buckets.map((day) => {
    const reward = REWARD_MIN + Math.floor(next() * REWARD_SPAN);
    const importDay = next() < IMPORT_DAYS;
    const importDraw = next();
    const imported = importDay ? IMPORT_MIN + Math.floor(importDraw * IMPORT_SPAN) : 0;
    const share = day === today ? 3 : 1;
    const rewards = new BigNumber(Math.floor(reward / share));
    const imports = new BigNumber(Math.floor(imported / share));
    const genesis = new BigNumber(day === GENESIS_DAY ? GENESIS_MINT : 0).shiftedBy(6);
    return {
      date: `${day}T00:00:00Z`,
      amount: units(rewards.plus(imports).plus(genesis)),
      rewards: units(rewards),
      import: units(imports),
      genesis_mint: units(genesis),
    };
  });
}

/**
 * Every synthetic answer of the supply page for a network: path and query of the request that asks for it and its body, in D7's key order. `last` is the newest ledger (its close time sets T, the
 * running day of the minted window) and `snapshot` the ledger the snapshot is of: XRPL's is an earlier recorded ledger, Xahau's the newest.
 */
export function supplyFixtures(net: NetworkName, last: LastValidated, snapshot: { ledger_index: number; close_time: string }): FixtureFile[] {
  const files: FixtureFile[] = [{ path: "/v2/network/supply", query: "", value: net === "xrpl" ? xrplSupply(snapshot) : xahauSupply(snapshot) }];
  if (net === "xahau") {
    const today = utcDayOf(Date.parse(last.close_time) / 1000);
    const w = windowOf(today, "90d");
    const rows = mintedDays(net, today);
    const page: MintedPage = { result: "success", coverage: COMPLETE(1), count: rows.length, rows };
    files.push({ path: "/v2/network/supply/minted", query: `end=${w.end}&interval=day&limit=1000&start=${w.start}`, value: page });
  }
  return files;
}
