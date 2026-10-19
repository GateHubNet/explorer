# Validators and Amendments Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/{net}/validators`, `/{net}/validators/{key}`, `/{net}/amendments` and `/{net}/amendments/{name}`, their two link-preview image kinds and the network page's links into them, from D1's six data API routes, behind E2's `VALIDATORS` switch.

**Architecture:** Each page is a route under `/:net` whose loader runs pure URL checks first, then D1's calls side by side through the subrequest cache (all with E2's failure hold), redirects to the one canonical URL, hands the answers to a pure view builder in `app/server/`, and returns `cached(...)`; the page component only draws the data and refreshes itself through E2's `createLiveOnScreen` and `keepLoaded`. Text rules shared by the four builders live in `app/server/validator-facts.ts`; the stored HTML holds absolute times, which `RelativeTime` and the new `Countdown` (used by E5 too) turn into ages and countdowns in the browser.

**Tech Stack:** React Router 8.4 (framework mode) on Cloudflare Workers, React 19, TypeScript, `bignumber.js`, `ripple-address-codec`, Vitest (`unit`, `components` with happy-dom, `worker` and E2's `worker-off` in workerd), Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-19-validators-amendments-pages-design.md` (the plan argues from the spec; executors read both). Section numbers below (§3.1, "Testing") are the spec's.

**Branch:** `feat/explorer-pages` of `/Users/golobitch/github.com/GateHubNet/x-explorer`. Before Task 1: the E2, E3 and E4 plans are built on this branch (E2's chart kit, live page, switches with `VALIDATORS` `"off"` everywhere, `navSection`, `keepLoaded`, `Anchor`, failure hold, "Cannot GET" rule and `PENDING_PATHS`; E3's `minute` class, `useRetry`, `paging.ts`; E4's `TimeSeriesData.extras`). D1 is built on data-api-new `feat/explorer-data` (worktree `/Users/golobitch/github.com/GateHubNet/data-api-new/.worktrees/explorer-data`), and its `docs/api-reference.md` documents D1 §3 with G1–G5. That worktree is read only with `git -C … show`, never checked out or changed.

## Global Constraints

- Edge classes: validators list `live` (5 s + 30 s); validator page `live-home` (1 s + 2 s), with `?marker=` `slow` with `ttl: 300`; amendments list and amendment page `minute` (60 s + 30 s, E3's class); `/og/{net}/{validator|amendment}/{id}.png` `slow`; 404s of an id and of a switched-off page `short`; query-tidying redirects `cacheClassHeaders("short")`; hex key → base58 `immutable`; signing key → master and amendment ref → canonical `slow`.
- Subrequests: `lastValidated` `{ ttl: HOME_CALL_TTL_SECONDS }` (2 s, the home page's key); S, L, D `live` kept `VALIDATORS_CALL_TTL_SECONDS = 10`; VV `live` kept `VALIDATIONS_CALL_TTL_SECONDS = 2`, with a marker `slow` kept `VALIDATIONS_MARKER_TTL_SECONDS = 300`; A and AD `minute`, no constant. L is always `limit=1000&scope=all`: one cached call per network serves every view, and filters are applied in the Worker.
- Polling pages (all four; not the validator marker view): every upstream call passes `holdFailure: true`; card-level calls are raced against E2's 4.5 s deadline from the loader's start (reason "took too long"); page-level calls (`lastValidated`, D, AD, and A on the amendments list) are not raced; everything is awaited with `Promise.allSettled` before anything is thrown.
- Beats: validator page `LIVE_REFRESH_MS` (4 s), validators list `VALIDATORS_REFRESH_MS = 10_000`, amendment pages `AMENDMENTS_REFRESH_MS = 60_000`; backoff cap `max(LIVE_REFRESH_MAX_MS, 4 × everyMs)`.
- No age or countdown is ever in stored HTML. All times UTC. No `Intl`, locale or clock in a render.
- Ages never more precise than the data: list "Last seen" `coarse={60}`, amendment page vote tables `coarse={300}`, validator page precise from VV and `coarse={60}` from D.
- Every text is made from D1's exact strings with `bignumber.js`; no float reaches a label.
- Every status is an icon and a word, never colour alone; colour only for `ok` and `bad`, with their icon.
- Majority wording: "more than 80%" (the threshold from `rules.threshold_percent`) and D1's `needed`; never "80%" alone, "holds at least 80%", or a spare other than `yes − needed`.
- One URL per view: canonical forms drop defaults, empty values, unknown values, repeats (the first is read) and unknown parameters, and order the rest as §1.4's tables list them. Only default views are indexable (canonical on the request's origin, `og:*`); every other view is `noindex, follow` with no canonical and no `og:*`.
- `VALIDATORS` off: the four pages and both image kinds answer a 404 of class `short` before any upstream call; the network page's "All validators" is "soon" and its five keys are text. This plan sets it `"on"` at the top level (`wrangler.jsonc` and the `worker` project's pinned bindings); `staging` and `production` stay `"off"`.
- A D1 route answering `Cannot GET …` is an outage (E2 §6.4): a 503 or a failed card, never stored. `Validator not found` and `amendment not found` stay `not_found`.
- No validator, domain or key is written in `app/`. Fixture domains are `*.example`.
- View builders are pure. Pages draw data and never fetch. Browser files (pages, UI components, the domain files they import, `meta.ts`) import nothing from `app/server` as values and never `ripple-address-codec`.
- External links: `target="_blank" rel="noopener noreferrer"` (a TOML file adds `nofollow`), the external icon, visually hidden "(opens in a new tab)".
- Live tables are `DataTable live`, keyed as §2.3 says; figures and tiles are `LiveValue` with their text as the token; no `aria-live`; reduced motion keeps the colours only; tables and the 30-day charts scroll inside their cards at 375 px.
- A mouse or pen over a live table, or keyboard focus on a link or button in it, holds the page (the home rules, `holdsFocus`, through `LiveControls.onHold`) and the live row says "Paused while you look at the table"; charts do not hold. The pause is E2's one `sessionStorage` key.
- Under each page's `<h1>` (not on the marker view): E2's `LiveRow` (`app/ui/components/LiveRow.tsx`), 44 px high from the start, with the live dot and its words ("Live · updates every ledger", "Live · updates every 10 s", "Live · updates every minute"), `LiveStatus`, the held note and `LiveToggle`.
- JS budget: 150,000 B gzip per page (`pnpm check:bundle`), target 145,000 B; over target, E2's fallback (`CursorSlot`: `Cursor` and the tooltip by `import()`).
- An E2, E3 or E4 piece is never redefined or forked; a missing prop is added in its own file (marked **Growth**).
- Worker specs share one Cache API per file: failure tests first, distinct ids, and the order each task gives. A failure is also held in memory for 5 s per key (E2's hold): a test that overrides a key an earlier test of the file failed first moves the fake `Date` past `FAILURE_HOLD_SECONDS`, as E2's `network-hold.spec.ts` does, or its override goes unused.
- `pnpm verify` exits 0 before every commit; `pnpm test:e2e` after a task that touches pages. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Leftover form fields and hand-written query strings.** A form sent without JavaScript arrives as `?scope=all&publisher=&amendment=&q=`; a pasted URL repeats or misspells parameters. Expect one 302 (`short`) to the canonical URL, with no upstream call when only the pure part changes, and a single 302 carrying both parts when `publisher` or `amendment` needs data. Pinned by Task 2 `validators-params.test.ts` and Task 10 `validators-page.spec.ts` ("pure redirects make no call", "one 302 carries both").
2. **An API without D1 against a real miss.** `Cannot GET` must be a 503 that is never stored; `Validator not found` / `amendment not found` a stored 404 `short` with the other network's offer. Pinned by Task 10 `validators-page-failures.spec.ts`, Task 12 `validator-page.spec.ts`, Task 13 `amendments-page.spec.ts`, Task 15 `amendment-page.spec.ts`.
3. **No age or countdown in a stored page, and no hydration mismatch.** The stored copy holds "expected 15:53 UTC" and absolute times; the browser shows "in ~11 min" and "3 s ago". Pinned by Task 1 `Countdown.test.tsx` (server text, hydration without mismatch) and the stored-HTML assertions of Tasks 10, 12, 13 and 15.
4. **Majority arithmetic at its edges.** yes = needed (spare 0: "One vote less and it loses majority."), yes > needed, trusted 1, trusted 0 ("—"), trusted < unl_size. Pinned by Task 14 `amendment-view.test.ts`.
5. **A key written another way.** 66 hex in any case and a signing key land on the master key's base58 URL with `marker` and `back` kept; a marker page never polls. Pinned by Task 2 `validator-key.test.ts`, Task 12 `validator-page.spec.ts` and Task 12's `routes-wiring.test.tsx` marker case.

---

## Task numbers

Revised after the cross-plan review: old Task 9 (validators list, route and page) is now **Task 9** (the page component, its meta builder and the switch flip) and **Task 10** (the route, the loader and their worker specs); old Tasks 10, 11, 12, 13, 14, 15 and 16 are now Tasks 11, 12, 13, 14, 15, 16 and 17. Other plans' pieces are named by name and file, never by their task numbers.

## Consumed from the earlier plans

Names as their specs fix them. A task that uses one says "(E2)", "(E3)" or "(E4)".

| Piece | Plan | Where |
|---|---|---|
| Chart kit: `ChartCard`, `LineChart` (`domain`, `curve="step"`, `references`), `ShareBar`, `Meter` (`small`), `StatTile figure`, `Cursor`, `ChartTable`, `Legend`, `labels.ts`, `geometry.ts`, `types.ts` (`TimeSeriesData` with `forming`, `TimeAxis` with unit `"flag"`, `ShareData`, `MeterData`, `Slot`) | E2 §2 | `app/ui/charts/` |
| `createLiveOnScreen({ order, merge })`, `keepLoaded`, `LivePart` | E2 §1.9, §6.3 | `app/ui/live-page.ts` |
| `useLiveControls(store)` (`LiveControls`), `LiveStatus`, `LiveToggle`, `DataTable` `live`/`compact`/`maxHeight`, `useLiveRows` | E2 §1.9 | `app/ui/use-live-controls.ts`, components |
| `Anchor`, `anchorOf(last)` | E2 §6.5 | `app/server/anchor.ts` |
| `utcDayOf(unixSeconds)` | E2 §6.6 | `app/domain/window.ts` |
| `features` on `Network`/`PublicNetwork`, `useFeatures()`, `featuresOf`, `cacheGeneration(env)`, the `worker-off` project (`test/worker/*-off.spec.ts`), `E2E_FEATURES_OFF` | E2 §6.1 | `app/ui/features.ts`, `env.ts` |
| `navSection`, `NetworkRouteHandle` | E2 §6.2 | `app/ui/route-handle.ts` |
| `holdFailure` on client calls, `FAILURE_HOLD_SECONDS`, the "Cannot GET" rule, `test/unit/pending-paths.test.ts` | E2 §1.4, §1.7, §6.4 | `app/server/data-api.ts`, `edge-cache.ts` |
| The validators card data and `NetworkPage.tsx` | E2 §1.3, §1.6 | `app/server/network-view.ts` |
| `fnv1a32(text): number`, `tokenOf(value): string` | E2 plan | `app/domain/fnv.ts` |
| `formatUtcDay(day: string, withYear = false): string` ("Oct 17", "Oct 17, 2026"; E2's fixed month table), `sharePercent(part: string, whole: string): string` (whole percents, half up, "<1%") | E2 plan | `app/domain/format.ts` |
| `mulberry32(seed)`, `seedOf(...parts)` | E2 plan | `scripts/synthetic.ts` |
| `CARD_DEADLINE_MS` (4,500), `byDeadline(work, at)`, `TooLate` ("took too long") | E2 plan | `app/server/deadline.ts` |
| `useHolds(onHold)` (`(name) => HoldHandlers`), `holdsFocus` | E2 plan | `app/ui/use-hold.ts` |
| `PENDING_PATHS` (E6 adds its entries there); `FreshOptions { ttl?; holdFailure? }`; `get()`'s options object `{ unwrap?, finish?, ttl?, holdFailure? }` | E2 plan | `app/server/pending-paths.ts`, `app/server/data-api.ts` |
| `ValidatorsView` (`first: { key; short; delay }[]`, `href`) | E2 plan | `app/server/network-view.ts` |
| `TOP_LEVEL_SWITCHES` (merged into `testBindings`) | E2 plan | `vitest.config.ts` |
| `LiveRow` (the live dot and words, `LiveStatus`, the held note, `LiveToggle`, 44 px from the start) | E2 plan | `app/ui/components/LiveRow.tsx` |
| `SegmentedLinks` (the `netswitch` group of `Link`s, `aria-current="true"` on the current one, 44 px targets) | E2 plan | `app/ui/components/SegmentedLinks.tsx` (exports `SegmentLink = { label; href; current }`) |
| `CursorSlot` (only if E2's bundle fallback created it) | E2 plan | `app/ui/charts/CursorSlot.tsx` |
| The cache class `minute` | E3 §2.5 | `app/server/cache-class.ts` |
| `useRetry()` | E3 §4.4 | `app/ui/use-retry.ts` |
| `parseTrail`, `trailPaging(page, href)`, `MAX_TRAIL`, `Paging` | E3 §3.6 | `app/domain/paging.ts` |
| `Meter decorative` | E3 §4.4 | the kit |
| The `.tag` class | E3 plan | `app/ui/components.css` |
| `TimeSeriesData.extras` (`TimeSeriesExtra`, with its `tooltip: "value"` for an extra whose values are whole phrases) | E4 §3.2 | `app/ui/charts/types.ts` |

**The pinned D1 reference.** Task 3 records `PIN`, the newest `feat/explorer-data` commit that touched `docs/api-reference.md`, which the types and the fixtures follow. It is named in Task 3's commit message and in `test/fixtures/PROVENANCE.md` (Task 4):

```sh
D1=/Users/golobitch/github.com/GateHubNet/data-api-new/.worktrees/explorer-data
PIN=$(git -C "$D1" log -1 --format=%H feat/explorer-data -- docs/api-reference.md)
git -C "$D1" show "$PIN:docs/api-reference.md"   # read, never check out
```

Where the reference and the D1 spec's examples differ, the reference wins.

---

### Task 1: Time words, coarse ages and `Countdown`

**Files:**
- Modify: `app/domain/format.ts` (`formatDate`, `formatDateTime`, `untilText`)
- Modify: `app/ui/components/RelativeTime.tsx` (`coarse`, exported `useClockSeconds`)
- Create: `app/ui/components/Countdown.tsx`
- Test: `app/domain/format.test.ts`, `app/ui/components/RelativeTime.test.tsx`, `app/ui/components/Countdown.test.tsx`

**Interfaces:**
- Consumes: E2's `formatUtcDay(day, withYear)` and its fixed month table in `format.ts` (the one table §2.4 asks for; `labels.ts` already uses it); E2's `serverThenHydrated` (`test/support/hydrate.tsx`) in the tests.
- Produces, `app/domain/format.ts`:
  ```ts
  export function formatDate(at: string | number): string;      // "Oct 9, 2026": formatUtcDay(its UTC day, true)
  export function formatDateTime(at: string | number): string;  // "Oct 9, 2026, 09:34 UTC"
  /** Time left until atMs; null when it is 0 or less (the caller shows its own past text). */
  export function untilText(atMs: number, nowMs: number, opts?: { approx?: boolean }): string | null;
  ```
  Both date functions take what `formatUtc` takes: an ISO date (`2026-09-20`) or date-time (`…Z`, with or without milliseconds), read as UTC, or a number as unix seconds (E5 passes `AmmInfo.auction_slot.expiration`); what is not a moment is returned as it came. Later tasks write "Oct 23" with `formatUtcDay(day)`.
- Produces, `RelativeTime.tsx`: prop `coarse?: number`; `export function useClockSeconds(): number | null` (the one shared one-second timer; `null` on the server and at hydration; no tick while `document.hidden`).
- Produces, `Countdown.tsx`. **E5 consumes exactly this:**
  ```ts
  export interface CountdownProps {
    /** The moment, unix seconds. A value that is not finite draws nothing. */
    at: number;
    /** The server's text and the first browser render's (the stored HTML): an absolute time ("expected 15:53 UTC"), or "". */
    fallback: string;
    /** The browser's text once `at` has passed ("due now", "expired"). */
    past: string;
    /** "~" before the number: the moment is an estimate. */
    approx?: boolean;
    /** Goes before the browser's text (the countdown or `past`) only, never before `fallback`. */
    lead?: string;
    className?: string;
  }
  export function Countdown(props: CountdownProps): JSX.Element | null;
  ```
  It renders `<time dateTime={ISO of at} title={formatDateTime(ISO of at)} className>` holding `fallback` while `useClockSeconds()` is `null`, else `${lead ?? ""}in ${untilText(at * 1000, now * 1000, { approx })}`, or `${lead ?? ""}${past}` when `untilText` is `null`.

- [ ] **Step 1: Write the failing tests**
  ```ts
  // format.test.ts
  const NOW = Date.UTC(2026, 9, 19, 15, 42, 0);
  it("untilText is null at and after the moment", () => { expect(untilText(NOW, NOW)).toBeNull(); expect(untilText(NOW - 1, NOW)).toBeNull(); });
  it.each([[59, "under a minute"], [60, "1 min"], [59 * 60 + 1, "60 min"], [3600, "1 h"], [47 * 3600 + 59 * 60, "47 h"], [48 * 3600, "2 days"], [3.5 * 86400, "4 days"]])(
    "untilText with %i s left is %s", (s, text) => expect(untilText(NOW + s * 1000, NOW)).toBe(text));
  it("approx puts ~ before the number only", () => {
    expect(untilText(NOW + 11 * 60_000, NOW, { approx: true })).toBe("~11 min");
    expect(untilText(NOW + 4 * 86_400_000, NOW, { approx: true })).toBe("~4 days");
    expect(untilText(NOW + 30_000, NOW, { approx: true })).toBe("under a minute");
  });
  it("writes UTC dates with the fixed month table", () => {
    expect(formatDate("2026-10-09T09:34:30Z")).toBe("Oct 9, 2026");
    expect(formatDate("2026-09-20")).toBe("Sep 20, 2026");
    expect(formatDateTime("2026-10-09T09:34:30Z")).toBe("Oct 9, 2026, 09:34 UTC");
    expect(formatDateTime("2026-07-21T08:00:12.004Z")).toBe("Jul 21, 2026, 08:00 UTC");
    expect(formatDateTime(1792256472)).toBe("Oct 17, 2026, 17:01 UTC");   // unix seconds
    expect(formatDate(1792256472)).toBe("Oct 17, 2026");
    expect(formatDate("soon")).toBe("soon");
  });
  // RelativeTime.test.tsx (AT as the file has it)
  it("says '< 1 min ago' under coarse={60}, then the age", …);   // AT+59 → "< 1 min ago"; AT+60 → "1 min ago"
  it("says '< 5 min ago' under coarse={300}, then the age", …);  // AT+299 → "< 5 min ago"; AT+300 → "5 min ago"
  it("prints only the fallback on the server with coarse", …);
  // Countdown.test.tsx; AT = Date.UTC(2026, 9, 19, 15, 53, 52) / 1000
  it("prints the fallback on the server, and nothing that counts", …);  // renderToString contains "expected 15:53 UTC", not "in ", datetime="2026-10-19T15:53:52.000Z", title="Oct 19, 2026, 15:53 UTC"
  it("hydrates the server's HTML without a mismatch", …);              // E2's serverThenHydrated(<Countdown …/>): errors empty
  it("counts down in the browser", …);                                  // now AT − 11 min → "in ~11 min" (approx); +60 s → "in ~10 min"
  it("says past once the moment has gone", …);                         // now AT + 1 → "due now"
  it("keeps an empty fallback on the server and puts lead before the browser's text only", …); // fallback "" → ""; lead ", " → ", in 9 h"
  it("does not tick while the tab is hidden", …);
  it("shares RelativeTime's one timer", …);                             // both mounted → vi.getTimerCount() === 1
  it("draws nothing for an at that is not a number", …);
  ```
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/domain/format app/ui/components/RelativeTime app/ui/components/Countdown` → FAIL: `untilText`, `formatDate`, `Countdown` not exported.
- [ ] **Step 3: Implement** `untilText` (≤ 0 → `null`; < 60 s "under a minute"; < 60 min ⌈s/60⌉ "N min"; < 48 h ⌊s/3600⌋ "N h"; else nearest whole day, half up, "N days"; `approx` writes "~" before N), the two date functions over `formatUtcDay`, `coarse` (under N seconds `< ${N / 60} min ago`, with `lead`), `useClockSeconds` (the existing `subscribe`/`clockSeconds`/`noClock` made a hook) and `Countdown` over it.
- [ ] **Step 4: Run the tests to verify they pass** — the command of Step 2 → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add app/domain/format.ts app/domain/format.test.ts app/ui/components/RelativeTime.tsx app/ui/components/RelativeTime.test.tsx app/ui/components/Countdown.tsx app/ui/components/Countdown.test.tsx` and `git commit -m "feat(ui): Countdown, coarse ages, untilText and UTC dates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 2: Keys, amendment refs, query parameters and links

**Files:**
- Create: `app/domain/validator-key.ts`, `app/domain/amendment-ref.ts`, `app/domain/validators-params.ts`, `app/domain/amendments-params.ts`
- Test: `app/domain/validator-key.test.ts`, `app/domain/amendment-ref.test.ts`, `app/domain/validators-params.test.ts`, `app/domain/amendments-params.test.ts`

**Interfaces:**
- Consumes: nothing new (`ripple-address-codec` in `validator-key.ts` only).
- Produces:
  ```ts
  // validator-key.ts: loaders and server code only (it imports ripple-address-codec)
  /** Base58, accepted by decodeNodePublic (version 0x1C, checksum, 33 bytes), first byte 0x02, 0x03 or 0xED. */
  export function isNodePublicKey(s: string): boolean;
  export function parseValidatorKey(raw: string): { key: string; from?: "hex" } | null;  // §1.2's table
  // amendment-ref.ts
  export const AMENDMENT_NAME: RegExp;                    // /^[A-Za-z][A-Za-z0-9_]{0,63}$/
  export type AmendmentRef = { id: string } | { name: string };
  export function parseAmendmentRef(raw: string): AmendmentRef | null;  // 64 hex first (upper-cased), then the name rule
  export function amendmentSegment(row: { id: string; name?: string }): string;  // name ?? id
  // amendments-params.ts (no imports)
  export const AMENDMENT_STATUSES: readonly ["majority", "voting", "enabled", "obsolete", "unknown"];
  export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];
  export interface AmendmentsParams { status?: AmendmentStatus }
  export function parseAmendmentsParams(search: string): AmendmentsParams;
  export function amendmentsHref(net: string, params: AmendmentsParams): string;
  export function amendmentHref(net: string, nameOrId: string): string;
  // validators-params.ts (imports amendment-ref.ts only)
  export type ValidatorScope = "unl" | "all";
  export interface ValidatorsParams { scope: ValidatorScope; publisher?: string; amendment?: string; q?: string }
  export const SEARCH_MAX = 100;
  export function parseValidatorsParams(search: string): ValidatorsParams;  // the pure part of §1.4
  export function validatorsHref(net: string, params: ValidatorsParams): string; // canonical; applies the pure rules itself
  export function canonicalValidatorsParams(
    params: ValidatorsParams,
    known: { publishers: readonly string[] | null; amendments: readonly { id: string; name?: string; status: AmendmentStatus }[] | null },
  ): ValidatorsParams;
  export function validatorHref(net: string, key: string, page?: { marker?: string; back?: readonly string[] }): string;
  ```
  Rules: `net` is a plain string, as `accountHref` takes it. The pure part: `scope` lower-cased, `unl` dropped, other values dropped; `q` trimmed, empty dropped, cut to its first 100 characters (code points, not UTF-16 units); `publisher` empty dropped; `amendment` empty or refused by `parseAmendmentRef` dropped, a hex ID upper-cased; repeats read the first; unknown parameters dropped; order `scope`, `publisher`, `amendment`, `q`, written by `URLSearchParams` (a space is `+`). The data part (`canonicalValidatorsParams`): `publisher` becomes S's spelling of a case-insensitive match, else dropped; `amendment` matches a row of status `majority`, `voting` or `unknown` (an ID exactly; a name exactly, else case-insensitively when that is unique) and becomes `amendmentSegment(row)`, else dropped; a `null` list keeps its parameter as given. `status` is lower-cased, one value, others dropped. `validatorHref` writes `?marker=M&back=M2.M1` and drops `back` without `marker`.

- [ ] **Step 1: Write the failing tests** — the cases of "Testing" for these four files. Keys are made in the test: `ED = encodeNodePublic(Uint8Array.from([0xed, ...Array(32).fill(0x11)]))`, `K02`, `K03` the same with `0x02`/`0x03`; IDs from D1 §3.5: `AMM_ID = "8CC0774A3BF66D1D22E76BBDA8E8A232E6B6313834301B3B23E8601196AE6455"`, `XCB_ID = "C98D98EE9616ACD36E81FDEB8D41D349BF5F1B41DD64A0ABC1FE9AA5EA267E9C"`, `UNKNOWN_ID = "98433DD001A5737F773D74F8CA2A25A065089C73B2E611C760BAF369E4FECA76"`.
  ```ts
  it("accepts base58 master and signing keys", () => { expect(parseValidatorKey(ED)).toEqual({ key: ED }); expect(parseValidatorKey(K02)).toEqual({ key: K02 }); });
  it.each([["a wrong checksum", ED.slice(0, -1) + (ED.endsWith("a") ? "b" : "a")], ["a classic address", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"], ["a truncated key", ED.slice(0, 20)],
    ["a 32-byte key", codec.encode(new Uint8Array(32).fill(7), { versions: [0x1c], expectedLength: 32 })], ["summary", "summary"], ["empty", ""]])("refuses %s", (_, k) => expect(parseValidatorKey(k)).toBeNull());
  const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));  // no Buffer: app/ has no Node types
  it.each(["02", "03", "ED"])("converts 66 hex with prefix %s in either case", (p) => {
    const bytes = bytesOf(p + "44".repeat(32));
    expect(parseValidatorKey((p + "44".repeat(32)).toLowerCase())).toEqual({ key: encodeNodePublic(bytes), from: "hex" });
    expect(parseValidatorKey(p + "44".repeat(32))).toEqual({ key: encodeNodePublic(bytes), from: "hex" });
  });
  it("refuses another prefix and 64 or 68 hex", …);             // "04"+…, "44".repeat(32), "02"+"44".repeat(33)
  it("reads 64 hex as an upper-case ID, before the name rule", () => { expect(parseAmendmentRef(XCB_ID.toLowerCase())).toEqual({ id: XCB_ID }); });
  it.each(["fix1201", "NonFungibleTokensV1_1", "fix240819", "XChainBridge", "AMM"])("accepts the name %s", (n) => expect(parseAmendmentRef(n)).toEqual({ name: n }));
  it.each(["fix-1201", "fix.1201", "fix 1201", "1201fix", "a".repeat(65), ""])("refuses %j", (n) => expect(parseAmendmentRef(n)).toBeNull());
  it.each([["", "/xrpl/validators"], ["?scope=unl", "/xrpl/validators"], ["?scope=ALL", "/xrpl/validators?scope=all"],
    ["?scope=all&publisher=&amendment=&q=", "/xrpl/validators?scope=all"], ["?q=%20north%20", "/xrpl/validators?q=north"],
    ["?q=x&scope=all", "/xrpl/validators?scope=all&q=x"], ["?scope=all&scope=unl", "/xrpl/validators?scope=all"],
    ["?scope=bogus&x=1", "/xrpl/validators"], [`?amendment=${XCB_ID.toLowerCase()}`, `/xrpl/validators?amendment=${XCB_ID}`],
    ["?amendment=no-such!", "/xrpl/validators"]])("the canonical form of %j is %s", (s, href) => expect(validatorsHref("xrpl", parseValidatorsParams(s))).toBe(href));
  it("cuts q at 100 characters, not UTF-16 units", () => expect(parseValidatorsParams(`?q=${encodeURIComponent("😀".repeat(101))}`).q).toBe("😀".repeat(100)));
  it("tidies publisher and amendment with S's and A's data", …); // "VL.Ripple.com" → "vl.ripple.com"; "nope.example" dropped; XCB_ID and "xchainbridge" → "XChainBridge"; "AMM" (enabled) dropped; UNKNOWN_ID kept
  it("keeps a parameter as given when its list is null", …);
  it("round-trips validatorsHref through parseValidatorsParams", …);
  it("writes validatorHref with marker and back, and drops back alone", …); // `/xrpl/validators/${ED}?marker=M3&back=M2.M1`; { back: ["M1"] } → bare
  it.each([["", undefined], ["?status=voting", "voting"], ["?status=VOTING", "voting"], ["?status=voting&status=enabled", "voting"],
    ["?status=voting,enabled", undefined], ["?status=", undefined], ["?x=1", undefined]])("status of %j", (s, st) => expect(parseAmendmentsParams(s).status).toBe(st));
  it("writes the amendment hrefs", …);                            // "/xrpl/amendments", "/xahau/amendments?status=majority", "/xrpl/amendments/AMM"
  ```
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/domain/validator-key app/domain/amendment-ref app/domain/validators-params app/domain/amendments-params` → FAIL: modules not found.
- [ ] **Step 3: Implement** the four files with the signatures above. `parseValidatorKey` tests 66 hex (`/^(02|03|ED)[0-9A-F]{64}$/i`) before base58.
- [ ] **Step 4: Run the tests to verify they pass** — the command of Step 2 → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add app/domain/validator-key.ts app/domain/amendment-ref.ts app/domain/validators-params.ts app/domain/amendments-params.ts app/domain/*.test.ts` and `git commit -m "feat(domain): validator keys, amendment refs and the canonical queries of the validators and amendments pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 3: The D1 client

**Files:**
- Modify: `app/server/api-types.ts` (the D1 types), `tsconfig.node.json` (include `app/domain/amendments-params.ts`, which `api-types.ts` now imports a type from)
- Modify: `app/server/data-api.ts` (six methods), `app/server/pending-paths.ts` (E2's: six `PENDING_PATHS` entries)
- Modify: `app/server/cache-class.ts` (three TTL constants)
- Create: `app/server/validators-shape.ts`, `test/support/d1-samples.ts`
- Test: `app/server/validators-shape.test.ts`, `app/server/cache-class.test.ts`, `test/unit/pending-paths.test.ts`, `test/worker/data-api.spec.ts`

**Interfaces:**
- Consumes: Task 2 `isNodePublicKey`, `AmendmentStatus`; E2's `PENDING_PATHS`, `FreshOptions`, `get()`'s options object and "Cannot GET" rule; E3's `minute`.
- Produces, `api-types.ts`, hand-written from `$PIN:docs/api-reference.md` (keys in its order, optional exactly where it says a key is absent): `ValidatorsSummary` (with `UnlPublisher`, `NextFlagLedger`, `NativeFees`, `VersionCount`), `Agreement`, `DomainVerification` (`accounts?`), `FeeVote`, `ValidatorRow`, `ValidatorsList`, `ValidatorVote` (`{ id; name?; status: "voting" | "majority" | "unknown"; vote: "yes" | "no" | "none" }`), `ValidatorDetail` (row + `amendment_votes.votes`, `manifest?`, `daily_agreement: DailyAgreement[]`), `ValidatorValidation`, `ValidatorValidationsPage` (not `Validation`: E2's `api-types.ts` declares that one for a ledger's validations, and interface merging would clash on `full`), `AmendmentRules`, `AmendmentRound`, `AmendmentRow` (`xls_url?`; `majority?: { since; ledger_index?; tx_hash?; expected_activation }`; `enabled?: { ledger_index?; date; tx_hash?; source: "ledger" | "metadata" }`), `AmendmentsEnvelope`, `AmendmentsList`, `AmendmentVote`, `AmendmentRoundPoint`, `AmendmentHistoryEvent`, `AmendmentDetail` (envelope + row + `unl_votes`, `other_votes`, `rounds`, `history`). `status` fields use `AmendmentStatus`.
- Produces, `DataApi` (`opts` is E2's `FreshOptions`):
  ```ts
  validatorsSummary(opts?): Promise<ValidatorsSummary>;                                   // /v2/network/validators/summary, live
  validators(q: { scope: ValidatorScope; limit: number }, opts?): Promise<ValidatorsList>; // ?limit=…&scope=…, live
  validator(key: string, opts?): Promise<ValidatorDetail>;                                  // /v2/network/validators/{key}, live
  validatorValidations(key: string, q: { limit: number; marker?: string }, opts?): Promise<ValidatorValidationsPage>; // live; with a marker: slow, kept VALIDATIONS_MARKER_TTL_SECONDS, opts.ttl ignored
  amendments(opts?): Promise<AmendmentsList>;                                               // /v2/network/amendments, minute
  amendment(ref: string, opts?): Promise<AmendmentDetail>;                                  // /v2/network/amendments/{name}, minute
  ```
  The six templates go in `PENDING_PATHS` with the path parameter names of `$PIN:docs/openapi.yaml`. Queries are written in the order `limit`, `marker`, `scope`, so the keys are `?limit=1000&scope=all`, `?limit=20`, `?limit=20&marker=…`.
- Produces, `cache-class.ts`: `VALIDATORS_CALL_TTL_SECONDS = 10`, `VALIDATIONS_CALL_TTL_SECONDS = 2`, `VALIDATIONS_MARKER_TTL_SECONDS = 300`.
- Produces, `validators-shape.ts`: `checkValidatorsSummary`, `checkValidatorsList`, `checkValidatorDetail`, `checkValidatorValidations` (not `checkValidations`, which is E2's in `aggregate-shape.ts`), `checkAmendments`, `checkAmendmentDetail`, each `(body: unknown, path: string) => T` returning the body typed (each is `get()`'s `finish`, run inside the cached load, as E2's `aggregate-shape.ts` checks are; a `void` check would make the method resolve to `undefined`), throwing `UpstreamError("server", …, { status: 200 })`: lists are arrays; times are strings; native amounts are decimal strings (`/^\d+(\.\d+)?$/`); `score` matches `/^\d\.\d{4}$/`; keys pass `isNodePublicKey` (or are `""` where the reference allows it); amendment IDs and hashes match `/^[0-9A-F]{64}$/`; counts are numbers.
- Produces, `test/support/d1-samples.ts` (for the unit and component tests of later tasks): `SAMPLE_KEYS` (valid node keys), `AMM_ID`, `XCB_ID`, `UNKNOWN_ID`, and `summarySample`, `validatorRowSample`, `validatorDetailSample`, `validationsSample`, `amendmentsSample`, `amendmentDetailSample`, each `(over?: Partial<T>) => T`: a small valid answer (XRPL values of D1 §3) with a shallow override.

- [ ] **Step 1: Pin the reference and write the failing tests.** Run the "pinned D1 reference" commands; `git -C "$D1" show "$PIN:docs/api-reference.md" | grep -n 'network/validators\|network/amendments\|accounts\|xls_url'` must show the six routes and G1–G5 (stop otherwise: D1 is not built as this plan needs). Then:
  ```ts
  // validators-shape.test.ts
  it.each([["validators summary", checkValidatorsSummary, summarySample()], …])("accepts a well-formed %s and returns it", (_, check, body) => expect(check(body, "/x")).toBe(body));
  it.each([["a score that is a number", validatorRowSample({ agreement_24h: { …, score: 0.9998 } })], ["a fee that is a number", …], ["validators that is not a list", { validators: {} }],
    ["a key that is an address", validatorRowSample({ validation_public_key: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" })], ["an ID that is not 64 hex", …], ["a signing_time that is a number", …]])(
    "refuses %s with a server error", …);   // expect UpstreamError, kind "server"
  // cache-class.test.ts: the three constants are 10, 2 and 300
  // pending-paths.test.ts: PENDING_PATHS holds the six D1 templates
  // data-api.spec.ts (recordingCache and mockUpstream as the file does today)
  it("asks D1's six paths with their queries, classes and TTLs", …);
  //   keys: "GET …/v2/network/validators/summary [kept 10 s]" (live), "GET …/v2/network/validators?limit=1000&scope=all [kept 10 s]" (live),
  //   "GET …/v2/network/validators/<K> [kept 10 s]" (live), "GET …/v2/network/validators/<K>/validations?limit=20 [kept 2 s]" (live),
  //   "GET …/validations?limit=20&marker=M1 [kept 300 s]" (slow; a passed ttl is ignored), "GET …/v2/network/amendments" (minute),
  //   "GET …/v2/network/amendments/AMM" (minute)
  it.each(SIX_METHODS)("%s: a malformed 200 is a server error and is not stored", …);  // the next call makes a new upstream request
  it("keeps Validator not found and amendment not found as not_found, and makes Cannot GET a server error", …);
  ```
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/server/validators-shape app/server/cache-class test/unit/pending-paths` and `pnpm test --project worker test/worker/data-api` → FAIL: missing exports and methods.
- [ ] **Step 3: Implement** the types, the constants, the shape checks, the samples and the six methods through the client's `get(template, params, query, cls, { unwrap?, finish, ttl, holdFailure })`, each passing its shape check as `finish` (run inside the cached load).
- [ ] **Step 4: Run the tests to verify they pass** — the commands of Step 2 → PASS; `pnpm verify` → exit 0 (`api:check` is untouched: the paths are pending).
- [ ] **Step 5: Commit** — `git add app/server/api-types.ts tsconfig.node.json app/server/data-api.ts app/server/pending-paths.ts app/server/cache-class.ts app/server/cache-class.test.ts app/server/validators-shape.ts app/server/validators-shape.test.ts test/support/d1-samples.ts test/unit/pending-paths.test.ts test/worker/data-api.spec.ts` and `git commit -m "feat(data-api): D1's validators and amendments calls, typed and checked" -m "Types follow docs/api-reference.md of data-api-new feat/explorer-data at <PIN>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 4: Synthetic D1 fixtures

**Files:**
- Create: `scripts/validators-fixtures.ts`, `test/support/validators-cases.ts`, `test/unit/validators-fixtures.test.ts`
- Modify: `scripts/http-fixtures.ts` (`generate()` calls `validatorsFixtures(net, last, ledgerValidations)` for each network after `networkFixtures(...)`, and puts each entry through its `api(net, path, query, value)`)
- Modify: `test/support/upstream-core.ts` (`dataApiAbsent`: the two route messages), `test/unit/upstream-core.test.ts`
- Modify: `test/fixtures/PROVENANCE.md` (section "Synthetic validators and amendments"), `README.md` ("Upstream fixtures" table: the new files, "generator (synthetic)")
- Generated by `pnpm fixtures:sync`: `test/fixtures/http/{xrpl,xahau}/data-api/network/validators…`, `…/network/amendments…`

**Interfaces:**
- Consumes: Task 3 types (the files are typed by them) and its `PIN` (named in Task 3's commit message: `git log -1 --grep "feat/explorer-data at"`); E2's `mulberry32` and `seedOf` (`scripts/synthetic.ts`, seeds `seedOf(net, route)`) and the ledger-validations bodies (`LedgerValidations`) of its `networkFixtures(...)` output, in memory; `ripple-address-codec` (`encodeNodePublic`, `encodeAccountID` for the accounts of G1); `node:crypto` (SHA-512). The fixtures test writes D1 §3.5's two IDs itself (`test/support/d1-samples.ts` is not in the Node config).
- Produces: `validatorsFixtures(net: NetworkName, last: LastValidated, ledgerValidations: readonly LedgerValidations[]): Array<{ path: string; query: string; value: unknown }>` (the shape of E2's `networkFixtures`). `ledgerValidations` are the values of the `/v2/ledgers/{hash}/validations` entries of that network's `networkFixtures(...)` result, handed over inside `generate()`, never read from disk, so `fixtures:sync` does not depend on the order files are written. And, for the worker specs (Vite `import.meta.glob`, as `test/support/ledger-hashes.ts` reads files):
  ```ts
  export type ValidatorCase = "verified-unl" | "with-accounts" | "unverified" | "pending" | "no-domain" | "never-seen" | "negative-unl"
    | "signing-key" | "votes-unknown" | "no-fee-vote" | "fee-higher" | "fee-lower" | "incomplete" | "no-score" | "xahau-build";
  export async function validatorCase(net: NetworkId, which: ValidatorCase): Promise<{ key: string; signing?: string; domain?: string }>;
  export async function fixtureValidatorKeys(net: NetworkId): Promise<string[]>;   // every key with a D file, for distinct ids
  export type AmendmentCase = "majority" | "voting" | "enabled-ledger" | "enabled-metadata" | "obsolete" | "unknown" | "retired";
  export async function amendmentCase(net: NetworkId, which: AmendmentCase): Promise<{ id: string; name?: string }>;
  export async function validationsMarker(net: NetworkId): Promise<{ key: string; marker: string }>;  // the one marker page
  ```
  The cases are found from the files' data (a predicate per case), never from a table of keys.
- Produces, `dataApiAbsent`: `/v2/network/validators/{key}` and `/v2/network/validators/{key}/validations` (key ≠ `summary`) → 404 `Validator not found`; `/v2/network/amendments/{name}` → 404 `amendment not found`. Everything else keeps E2's "Cannot GET".

**What the generator writes** (spec "Testing", "Fixtures"; shapes, key orders and rules of `$PIN:docs/api-reference.md`; seeded per network and route):
- **Anchor.** `ledger_index` and times follow the recorded `last_validated` (XRPL 107721455 at 2026-10-17T17:01:12Z, Xahau 26596843); `next_flag_ledger` is the multiple of 256 above it, `voting_ledger` the one before, `expected` the close time plus 3.9 s per ledger.
- **Fleet.** XRPL 35 UNL + 25 others, Xahau 31 + 10. The master keys start with every `validation_public_key` of those ledger-validations bodies (in `first_datetime` order, so the network page's first-seen keys have validator pages; "others" grows if those files hold more keys than the fleet), then seeded ones: `0xED` + 32 seeded bytes, signing keys `0x02`/`0x03` + 32, encoded with `encodeNodePublic`. Domains `*.example`. Every case of `ValidatorCase`: verified, each `unverified` reason of §4.2, `pending`, no domain; on two lists, on one, on none; on the negative UNL with `negative_unl_pending.to_reenable`; no fee vote, a higher and a lower one; incomplete agreement, no score; a UNL member never seen; a verified validator whose TOML lists accounts (G1); a validator whose `votes[]` holds the `unknown` amendment (G4); Xahau `version_build`. L rows in D1's order; S counts, versions and `versions_unknown` summed from the rows.
- **Amendments.** Real names with `id = SHA-512Half(name)` upper-cased. XRPL: `MPTokensV1` `majority` with 30 days of rounds (about 2,600, one per flag ledger) and a got / lost / got history whose last `got_majority` is 10 days before the anchor (so it activates in 4 days); `XChainBridge`, `DynamicNFT` and `PermissionedDomains` `voting` with 3 days of rounds; `AMM` (with `xls: "XLS-30"` and its `xls_url`) and `DID` `enabled` from the ledger; `fix1201` `enabled` from metadata; `fixNFTokenNegOffer` `obsolete`; `UNKNOWN_ID` `unknown` with no name. Xahau: `Remit` `majority` without `majority.ledger_index` and `tx_hash` (G5); `URIToken` `voting`; `Hooks` and `Import` `enabled`; `XahauGenesis` `retired`; `introduced` in xahaud's date form. `needed = threshold + 1` (1 when trusted ≤ 1), `passes` by D1 F7, `counts`, and A's order rule. Every AD carries A's envelope (G3).
- **Files** per network: `data-api/network/validators/summary.json`; `data-api/network/validators@limit=1000&scope=all.json`; `data-api/network/validators/<KEY>.json` for every row, and `<SIGNING_KEY>.json` holding its master's answer; `…/<KEY>/validations@limit=20.json` for every row (empty `validations` for the never-seen member), and for one validator its `marker` page `…@limit=20&marker=<M>.json` (rows `matches`, one `different`, the newest `unknown`, a partial one); `data-api/network/amendments.json`; `data-api/network/amendments/<NAME>.json` for each named amendment plus a byte copy `<ID>.json` (D1 answers an ID too), and `<ID>.json` for the nameless one. One line per row, sorted keys where the other fixtures sort them.

- [ ] **Step 1: Write the failing tests**
  ```ts
  // validators-fixtures.test.ts (Node; reads the generated map, not the files)
  it("names AMM and XChainBridge by D1's known IDs", …);        // SHA-512Half("AMM") === AMM_ID, ("XChainBridge") === XCB_ID
  it.each(["xrpl", "xahau"])("%s: every key is a node key and every domain is *.example", …);
  it.each(["xrpl", "xahau"])("%s: the list is in D1's order, and the summary's counts and versions add up from it", …);
  it.each(["xrpl", "xahau"])("%s: holds every validator case", …);  // one predicate per ValidatorCase
  it("XRPL's majority amendment has 2,500 to 2,700 rounds and a got/lost/got history", …);
  it("Xahau's majority amendment has no majority.ledger_index or tx_hash", …);
  it.each(["xrpl", "xahau"])("%s: needed, passes, pct, counts and A's order obey D1's rules", …);
  it.each(["xrpl", "xahau"])("%s: every amendment file carries A's envelope", …);
  it("writes every object's keys in the reference's order", …);  // a table of key orders copied from $PIN:docs/api-reference.md
  it("the signing key's file answers its master", …);
  it("has a validator file for every key of E2's ledger validations fixtures", …);  // from generate()'s own map
  it("gives the same output for the same input, whatever order the files are written in", …);
  // upstream-core.test.ts
  it("answers an unknown validator and amendment with the routes' own not-found messages", …); // and summary/validations stay as they were
  ```
- [ ] **Step 2: Run them to verify they fail** — `pnpm test test/unit/validators-fixtures test/unit/upstream-core` → FAIL: module not found / wrong message.
- [ ] **Step 3: Implement** `validatorsFixtures(...)`, wire it into `generate()` after `networkFixtures(...)`, extend `dataApiAbsent`, write `validators-cases.ts`, run `pnpm fixtures:sync`, and add the PROVENANCE section (the generator, its seeds, and `PIN` from Task 3's commit message) and the README rows.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS; `pnpm fixtures:check` → "… generated fixture files are up to date"; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add scripts/validators-fixtures.ts scripts/http-fixtures.ts test/support/validators-cases.ts test/support/upstream-core.ts test/unit/validators-fixtures.test.ts test/unit/upstream-core.test.ts test/fixtures/http test/fixtures/PROVENANCE.md README.md` and `git commit -m "test(fixtures): synthetic answers of D1's validators and amendments routes" -m "Shapes follow docs/api-reference.md of data-api-new feat/explorer-data at <PIN>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 5: Shared facts

**Files:**
- Modify: `app/server/networks.ts` (`software`), `app/ui/networks.ts` (`NetworkInfo` gains `"software"`), `app/server/networks.test.ts`
- Create: `app/server/validator-facts.ts`
- Test: `app/server/validator-facts.test.ts`

**Interfaces:**
- Consumes: Task 1 date functions, E2's `formatUtcDay` and `sharePercent`, Task 3 types, `formatAmount`, `shortHash`, `isValidClassicAddress`.
- Produces: `Network.software: "rippled" | "xahaud"` (XRPL `rippled`, Xahau `xahaud`), and in `validator-facts.ts`:
  ```ts
  export type TextPart = string | { text: string; href: string; external?: "plain" | "nofollow"; mono?: boolean }
    | { countdown: { at: number; fallback: string; past: string; approx?: boolean; lead?: string } };
  export function unixOf(iso: string): number;                          // NaN for what is not a time
  export function scoreText(score: string | undefined): string;         // "0.9998" → "99.98%", "1.0000" → "100.00%", none → "—"
  export function ledgersText(a: { missed: number; total: number; partial: number }): string;  // "4 missed of 22,096 validated ledgers · 1 partial"
  export function dropsText(native: string): string;                    // "0.00001" → "10 drops"
  export function nativeText(native: string, unit: string): string;     // "0.2" → "0.2 XRP"
  export function versionText(v: { version?: string; version_build?: number }, withBuild: boolean): string | null; // "2026.10.13 · build 4119"
  export function yesPercentText(yes: number, trusted: number): string; // 1 decimal: "88.6%"; trusted 0 → "—"
  export function yesPercentValue(yes: number, trusted: number): string | null; // 2 decimals for charts: "88.57"; trusted 0 → null
  export function shareText(part: number, whole: number): string;  // table shares, 1 decimal: "87.8%" (labels use E2's sharePercent: "88%", "<1%")
  export function compareFee(vote: string, now: string): "higher" | "lower" | "same";
  export function moreThan(thresholdPercent: number): string;           // "more than 80%"
  export function joinAnd(items: readonly string[]): string;            // "a", "a and b", "a, b and c"
  export function tomlFileOf(software: Network["software"]): "xrp-ledger.toml" | "xahau.toml";
  export function tomlLink(dv: DomainVerification | undefined, domain: string | undefined, software: Network["software"]): string | null;
  export function xlsLink(url: string | undefined): string | null;     // https, host github.com, path under /XRPLF/XRPL-Standards/
  export function accountLinks(net: string, accounts: readonly string[] | undefined): { address: string; href: string }[] | null;
  export function verificationNote(dv: DomainVerification | undefined, domain: string | undefined, software: Network["software"]): TextPart[] | null;
  export type DomainStatusKind = "verified" | "unverified" | "pending";
  export type AmendmentStatusView =
    | { status: "enabled"; retired: boolean }
    | { status: "majority"; activation: { at: number; fallback: string } }   // fallback "expected Oct 23" (formatUtcDay)
    | { status: "voting" | "unknown"; share: string }                       // yesPercentText
    | { status: "obsolete" };
  export function amendmentStatusView(row: AmendmentRow): AmendmentStatusView;
  export function statusWord(status: AmendmentStatus): string;          // "Activated", "Activating", "Voting", "Obsolete", "Unknown"
  ```
  `tomlLink` is the §2.8 check: `status === "verified"` and `toml_url === \`https://${domain}/.well-known/${tomlFileOf(software)}\``. `verificationNote` holds the sentences of §4.2 verbatim (the file name a link when `tomlLink` gives one, then "Checked {formatDateTime(checked)}."), "The domain could not be verified." for an unknown reason, `null` without a domain. `accountLinks` keeps classic addresses with a valid checksum (`/{net}/account/{address}`), `null` when the field is absent.

- [ ] **Step 1: Write the failing tests** — `validator-facts.test.ts` covers §2.5 and §2.6 and the §4.2 sentences:
  ```ts
  it.each([["0.9998", "99.98%"], ["1.0000", "100.00%"], [undefined, "—"]])("scoreText(%j) is %s", …);
  it("writes ledger counts with and without partial", …);   // "4 missed of 22,096 validated ledgers · 1 partial"; partial 0 → no " · 0 partial"
  it("writes fees and reserves exactly", …);                // "0.00001" → "10 drops", "0.000012" → "12 drops", ("1","XRP") → "1 XRP"
  it("writes a Xahau build only when asked", …);
  it("writes yes shares, with — for no trusted validators", …); // (31, 35) → "88.6%" and "88.57"; (0, 0) → "—" and null
  it("compares fee votes as numbers", …);                   // ("0.000012","0.00001") higher; ("0.2","0.2") same; ("1","1.0") same
  it("says more than 80%", () => expect(moreThan(80)).toBe("more than 80%"));
  it.each([["https://other.example/.well-known/xrp-ledger.toml"], ["https://a.example/xrp-ledger.toml"], ["http://a.example/.well-known/xrp-ledger.toml"], ["https://a.example/.well-known/xahau.toml"]])(
    "does not link the TOML %s for a.example on XRPL", (url) => expect(tomlLink({ status: "verified", toml_url: url } as DomainVerification, "a.example", "rippled")).toBeNull());
  it("links a verified TOML, never an unverified one", …);
  it("links XLS documents only on github.com under /XRPLF/XRPL-Standards/", …);
  it("skips an account that is not a classic address, and has no line without the field", …);
  it.each(VERIFICATION_CASES)("says %s", …);                // every row of §4.2, with the file name per network, plus an unknown reason
  it("maps each amendment status to its view", …);          // majority → { at: unixOf(expected_activation), fallback: "expected Oct 23" }
  ```
  and `networks.test.ts`: `software` on both networks and on `publicNetwork(...)`.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/server/validator-facts app/server/networks` → FAIL.
- [ ] **Step 3: Implement** the functions with `bignumber.js` for every number (score × 100 to 2 decimals; drops = whole units × 10⁶; shares half up).
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS; `pnpm verify` → exit 0 (test data that builds a `Network` or `NetworkInfo` by hand gains `software`).
- [ ] **Step 5: Commit** — `git add app/server/networks.ts app/server/networks.test.ts app/ui/networks.ts app/server/validator-facts.ts app/server/validator-facts.test.ts` (and any test data updated) and `git commit -m "feat(validators): the text rules the four pages share" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 6: Status marks

**Files:**
- Modify: `app/ui/components/Pill.tsx` (tones `info`, `off`), `app/ui/components/icons.tsx`, `app/ui/components.css` (`.pill--info`, `.pill--off`; the UNL, Negative UNL and "retired" tags reuse E3's `.tag` class)
- Create: `app/ui/components/StatusMarks.tsx`
- Test: `app/ui/components/StatusMarks.test.tsx`, `test/unit/tokens.test.ts`

**Interfaces:**
- Consumes: Task 1 `Countdown`, Task 5 `TextPart`, `DomainStatusKind`, `AmendmentStatusView` (type imports); E3's `.tag` class.
- Produces: `PillTone = "ok" | "bad" | "neutral" | "info" | "off"`; icons `ShieldIcon`, `ClockIcon`, `BallotIcon`, `MinusCircleIcon`, `QuestionIcon`, `LatestIcon`, `ExternalIcon`, `CheckCircleIcon`, `AlertCircleIcon`, `DashIcon`, `EqualsIcon`, `ArrowUpIcon`, `ArrowDownIcon` (one already added by an earlier plan under that name is reused); and in `StatusMarks.tsx`:
  ```tsx
  export function Parts({ parts }: { parts: readonly TextPart[] }): JSX.Element;    // strings, internal Links, ExternalLinks, Countdowns
  export function ExternalLink({ href, nofollow, children }: { href: string; nofollow?: boolean; children: ReactNode }): JSX.Element;
  export function DomainStatus({ status, page }: { status: DomainStatusKind; page?: boolean }): JSX.Element;
  export function UnlTag({ publishers }: { publishers: readonly string[] }): JSX.Element;
  export function NegativeUnlTag(): JSX.Element;
  export function LatestMark(): JSX.Element;
  export function IncompleteMark(): JSX.Element;
  export function AmendmentStatusPill({ view }: { view: AmendmentStatusView }): JSX.Element;
  export function VotePill({ vote }: { vote: "yes" | "no" | "none" }): JSX.Element;
  export function ValidationPill({ validated, validatedShort }: { validated: "matches" | "different" | "unknown"; validatedShort?: string }): JSX.Element;
  export function FeeArrow({ against }: { against: "higher" | "lower" | "same" }): JSX.Element | null;  // the list's ↑ ↓
  export function FeePill({ against }: { against: "higher" | "lower" | "same" }): JSX.Element;          // the validator page's
  ```
  Each draws §2.5's row: icon, word, tone. `UnlTag`: shield, "UNL", then visually hidden " Listed by {joinAnd(publishers)}" and the same words as `title`. `AmendmentStatusPill` majority: `.pill--info`, clock, "Activating, " + `Countdown` (`fallback` from the view, `past` "at the next flag ledger"); enabled with `retired` adds the `.tag` "retired". `FeeArrow`: `↑`/`↓` `aria-hidden` plus visually hidden ", higher than now" / ", lower than now"; nothing for `same`. `ValidationPill` "different": visually hidden "validated ledger {validatedShort}". `ExternalLink`: §2.8's attributes, `ExternalIcon`, visually hidden "(opens in a new tab)".
  CSS: `.pill--info { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--fg) }`; `.pill--off { background: transparent; color: var(--muted); border: 1px solid var(--border) }`.

- [ ] **Step 1: Write the failing tests**
  ```tsx
  it.each(DOMAIN_CASES)("DomainStatus %s draws its icon and words", …);  // "verified" / "Domain verified", "not verified", "not checked yet"
  it("names the UNL tag by its word and publishers, not by its title", …);  // accessible name "UNL Listed by vl.ripple.com and unl.xrplf.org"
  it.each(AMENDMENT_VIEWS)("AmendmentStatusPill %s", …);  // "Activated" (+ "retired"), "Voting", "Obsolete", "Unknown" (pill--off, question)
  it("prints 'Activating, expected Oct 23' on the server and 'Activating, in 4 days' in the browser", …);
  it.each([["yes", "Yes"], ["no", "No"], ["none", "No recent vote"]])("VotePill %s says %s", …);
  it.each([["matches", "Matches"], ["different", "Different hash"], ["unknown", "Not indexed yet"]])("ValidationPill %s says %s", …);
  it("FeeArrow and FeePill say higher, lower and same in words", …);
  it("ExternalLink opens a new tab safely and says so", …);  // target, rel (with nofollow), sr text, icon aria-hidden
  it("Parts draws strings, links and countdowns", …);
  ```
  `tokens.test.ts`: `--fg` on `.pill--info`'s mix (12% accent over `--surface`) and `--muted` on `--surface` for `.pill--off`, both accents, light and both dark blocks, each ≥ 4.5:1; the rules read from `components.css`.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/ui/components/StatusMarks test/unit/tokens` → FAIL.
- [ ] **Step 3: Implement** the tones, icons (24 px grid, rounded strokes, `aria-hidden`, as the file's others), CSS and components.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add app/ui/components/Pill.tsx app/ui/components/icons.tsx app/ui/components.css app/ui/components/StatusMarks.tsx app/ui/components/StatusMarks.test.tsx test/unit/tokens.test.ts` and `git commit -m "feat(ui): status marks of validators and amendments, always an icon and a word" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 7: Chart kit and live-pace growth

**Files:**
- Modify (**Growth**, E2's files): `app/ui/charts/labels.ts` (`"flag"` texts, `extreme`), `app/ui/charts/geometry.ts` (step compression), `app/ui/charts/Cursor.tsx` (`pageStep`), `app/ui/charts/LineChart.tsx` (passes `pageStep` and `extreme`), and `app/ui/charts/CursorSlot.tsx` (passes `pageStep` on to `Cursor`) only if E2's bundle fallback created it. `ChartCard`'s `table?: ReactNode` is E2's already (E2 plan: "E6 adds nothing"); the pages pass their own tables there.
- Modify: `app/ui/use-live-refresh.ts` (`everyMs`, the two constants), `app/ui/use-live-controls.ts` (**Growth**, E2's: passes `everyMs` through)
- Test: E2's `app/ui/charts/labels.test.ts`, `geometry.test.ts`, `Cursor.test.tsx` and `LineChart.test.tsx` (with E2's `serverThenHydrated`); `app/ui/use-live-refresh.test.tsx`

**Interfaces:**
- Consumes: E2's kit (and its `CursorSlot`, if it exists); E4's `extras` and its `tooltip: "value"`, which this plan's "Ledgers" and "Round" extras set because their values are whole phrases.
- Produces:
  - `TimeAxis.unit "flag"` texts: x labels stay days (`Oct 16`, E2's picks); tooltip, slider and table dates become `formatDateTime` of the bucket (E2 writes "Oct 16, 2026, 17:01"; this adds " UTC", as §7 fixes them).
  - `geometry.ts`: `linePath(…, { curve: "step" })` emits a vertex only where the value changes (runs of one value are one segment; `null` still breaks the path).
  - `Cursor` / `LineChart` (and `CursorSlot`, when it exists) prop `pageStep?: number`: Page Up moves that many buckets towards the newest, Page Down towards the oldest, clamped; `aria-keyshortcuts="PageUp PageDown"`.
  - `labels.ts`: `plotSummary(title, data, opts?: { extreme?: "highest" | "lowest" })` (default `"highest"`; `"lowest"` names the earliest of equal lows); `LineChart` prop `extreme` of the same type.
  - `export const VALIDATORS_REFRESH_MS = 10_000; export const AMENDMENTS_REFRESH_MS = 60_000;` `refreshInterval(failures: number, everyMs = LIVE_REFRESH_MS): number` = `min(everyMs × 2^failures, max(LIVE_REFRESH_MAX_MS, 4 × everyMs))`; `useLiveRefresh({ …, everyMs? })`; `useLiveControls(store, opts?: { everyMs?: number })`.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("a step line on a flag axis shows its Round extra as a phrase in the tooltip, and reads it in the slider", …);
  //   extras [{ id: "round", label: "Round", tooltip: "value", values: ["flag ledger #107,721,408 · 29 of 35 UNL validators · majority", …] }]
  //   the tooltip's extra row text is exactly "flag ledger #107,721,408 · 29 of 35 UNL validators · majority" (no lowered label after it);
  //   tooltip date "Oct 16, 2026, 09:34 UTC"; aria-valuetext ends with "Round flag ledger #107,721,408 · 29 of 35 UNL validators · majority"; x labels "Oct 16"
  it("a day line shows its Ledgers extra as a phrase in the tooltip", …);  // tooltip: "value", value "4 missed of 22,096 validated ledgers · incomplete": the row is that text
  it("a step path of 2,600 values with 5 changes is 12 commands", …);
  it("Page Up and Page Down move pageStep buckets, clamped, and are named in aria-keyshortcuts", …); // pageStep 87 from the newest: PageDown → n−88; the same through CursorSlot when it exists
  it("names the lowest bucket with extreme lowest", …);      // "Lowest Oct 3, 99.31%; latest Oct 19, 99.98%"; default still "Highest …"
  it("refreshInterval follows everyMs and caps at max(60 s, 4 × everyMs)", () => {
    expect(refreshInterval(0, 10_000)).toBe(10_000); expect(refreshInterval(3, 10_000)).toBe(60_000);
    expect(refreshInterval(2, 60_000)).toBe(240_000); expect(refreshInterval(9, 60_000)).toBe(240_000); expect(refreshInterval(5)).toBe(60_000);
  });
  it("beats every everyMs", …);                              // useLiveRefresh({ everyMs: 10_000 }): no revalidate at 4 s, one at 10 s
  ```
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/ui/charts app/ui/use-live-refresh` → FAIL on the new cases only.
- [ ] **Step 3: Implement** each growth in its own file, defaults keeping E2's behaviour.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS (E2's cases unchanged); `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add app/ui/charts app/ui/use-live-refresh.ts app/ui/use-live-refresh.test.tsx app/ui/use-live-controls.ts` and `git commit -m "feat(charts): flag axis texts, step compression, page steps, the lowest extreme and a slower beat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 8: Validators list, view builder

**Files:**
- Create: `app/server/validators-view.ts`
- Test: `app/server/validators-view.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5; `Loaded` (`app/server/account-view.ts`); E2's `ShareData`, `fnv1a32`, `tokenOf`.
- Produces:
  ```ts
  export function versionSlots(newestFirst: readonly string[]): Map<string, 1 | 2 | 3 | 4>;
  export function validatorsPage(input: {
    network: NetworkInfo;                 // with software
    params: ValidatorsParams;             // canonical (Task 2's rules already applied by the loader)
    summary: Loaded<ValidatorsSummary>;
    list: Loaded<ValidatorsList>;
    amendments: Loaded<AmendmentsList>;
  }): ValidatorsPageData;
  export interface ValidatorsPageData {
    network: NetworkInfo; params: ValidatorsParams;
    hrefs: { amendments: string; action: string; scope: { unl: string; all: string }; clear: string | null };
    intro: TextPart[];
    summary: { state: "ok"; notices: string[]; tiles: { label: string; value: string; sub: TextPart[] }[];
               versions: { chart: ShareData; table: VersionRow[]; notes: string[] }; publishers: Option[] | null } | { state: "failed" };
    list: { state: "ok"; counts: { unl: number; all: number }; rows: ValidatorRowView[]; footer: string[]; empty: boolean } | { state: "failed" };
    amendments: { state: "ok"; options: Option[] } | { state: "failed" };
  }
  ```
  `Option = { value: string; label: string }`; `VersionRow` and `ValidatorRowView` hold the strings and hrefs of §3.1's table (row key `validation_public_key`; name `{ text, mono }`, `href`, `sub`, `domainStatus`, `unl`/`unlPublishers`, `negativeUnl`, version `{ text, latest }`, agreement `{ text, incomplete }`, fee cells `{ text, against? }[]` or `null`, `yes: { label, href }[]`, `lastSeen: number | null`). `missing` counts as `failed` for S, L and A. `summary.publishers` is `null` with fewer than two publishers.

**Rules** (§3.1 and §3.2 verbatim, with these values): intro "The default UNL is the list of validators {software} trusts out of the box, published by {joinAnd(ids)}. All adds every other validator whose validations reached the data API in the last 24 hours." (no ", published by …" without S); the publisher notices of §3.1 (expired: "{id}'s list expired on {formatDate(expiration)}. The data API still uses it, as a node would rather use an old list than none."; unavailable: "{id} has not been fetched yet ({last_error})." without the brackets when there is no error; plus "No validator is trusted until one is." when every publisher is unavailable); the six tiles of §3.1 in order (tile 4's names from L by key, short key otherwise, up to three, then "and N more"; tile 6's sub a countdown `{ at: unixOf(expected), fallback: "expected HH:MM UTC", past: "due now", approx: true }` then " · fee and amendment votes are counted there"); filters by `scope`, `publisher` (`unl_lists`), `amendment` (its ID from A, or `yes[].id`/`yes[].name` as given when A failed) and `q` (lower-cased substring of `domain`, `validation_public_key` or `signing_key`); counts before `publisher`, `amendment` and `q`; footer "{n} validators" / "{n} matches" (one: "1 validator" / "1 match"), "in the order of their domain, then their key", "Fee votes in XRP / XRP / drops; ↑ ↓ against the current value", "Fee votes are not compared with the current fees: they could not be loaded" without S, and "The first 1,000 validators in this order are shown." when L has a `marker`; amendment options from A's `majority`, `voting` and `unknown` rows in A's order, labelled "{name or shortHash(id)} · {yesPercentText}".

**Version slots** (an algorithm the signature does not fix):
```ts
// own(v) = 1 + fnv1a32(v) % 4                     (E2's app/domain/fnv.ts)
// The shown versions are the four newest of S's versions[]. Assign from the oldest of them to the newest:
//   slot = own(v) when it is free, else the next free slot after it, cyclically 1 → 2 → 3 → 4 → 1.
```
The chart's rows are "UNL" and "All", each `total` the sum of its segments ("35 validators" in the label column); segments are the shown versions newest first plus "Other" (`slot: "other"`, older versions plus `versions_unknown`; left out when 0); labels E2's `sharePercent` (whole percents, "<1%"), the table's shares `shareText` (1 decimal); the table one row per version of `versions[]` plus "Unknown"; notes "Each validator's version as it reports it in its validations." then, with more than four versions, "“Other” groups releases older than {4th} and validators whose version is not known." (with four or fewer and some unknown: "“Other” is the validators whose version is not known."), then "Latest release on the UNL: {latest_version}."; `token` = `tokenOf` of the drawn data.

- [ ] **Step 1: Write the failing tests** — `validators-view.test.ts`, the list of "Testing" for this file, from `d1-samples`:
  ```ts
  it.each(FILTER_CASES)("filters by %s", …);          // scope, publisher, amendment by ID and as given without A, q over domain / master / signing key in any case, a combination
  it("counts UNL and All before the other filters, and keeps D1's order", …);
  it("notes the first 1,000 when the list has a marker", …);
  it("writes the six tiles", …);                       // "35 / 35"; "28 of 35" with " · the node reports 27" only when node differs; negative UNL names, "and 2 more", "re-enabled at the next flag ledger"; "1 / 0.2 XRP", "base fee 10 drops"
  it("shows the four newest versions with Other for older and unknown ones, and exact shares", …);
  it("keeps each version's colour when a newer release arrives", () => {
    const before = versionSlots(["3.4.1", "3.4.0", "3.3.0", "3.2.0"]); const after = versionSlots(["3.5.0", "3.4.1", "3.4.0", "3.3.0"]);
    for (const v of ["3.4.1", "3.4.0", "3.3.0"]) expect(after.get(v)).toBe(before.get(v));
  });
  it("draws fewer segments for fewer versions, and no Other when it is empty", …);
  it("puts fee arrows against S, none without S, and says why", …);
  it("writes agreement, incomplete and the yes list", …);
  it("gives last seen as unix seconds, and null for a validator never seen", …);
  it("degrades each part on its own", …);              // S, L, A failed → that part { state: "failed" }; intro without publishers
  it("changes its token with any drawn value only", …);
  it("puts no float in any string", …);                // a JSON scan of the output for /\d\.\d{5,}/
  ```
- [ ] **Step 2: Run it to verify it fails** — `pnpm test app/server/validators-view` → FAIL: module not found.
- [ ] **Step 3: Implement** `validatorsPage` and `versionSlots` in `validators-view.ts`.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add app/server/validators-view.ts app/server/validators-view.test.ts` and `git commit -m "feat(validators): the view builder of the validators list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 9: Validators list, page component

**Files:**
- Create: `app/ui/pages/ValidatorsPage.tsx`, `app/ui/pages/ValidatorsPage.test.tsx`, `test/unit/validators-bundle.test.ts`
- Modify: `app/ui/pages.css`, `app/server/meta.ts` (`validatorsMeta`), `app/server/meta.test.ts`
- Modify (the switch flip): `wrangler.jsonc` (top-level `VALIDATORS: "on"`), `vitest.config.ts` (`TOP_LEVEL_SWITCHES.VALIDATORS: "on"`; `worker-off` unchanged), and any `worker`-project or e2e assertion of E2's that expects "All validators" to be "soon" at the top level (it is a link now; E2's `network-off.spec.ts` keeps the off case). Until Task 10 adds the route, that link leads to the not-found page.

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 6, 7, 8 (`RelativeTime coarse`, `validatorsHref`, `TextPart`, the marks, `ValidatorsPageData`); E2's `LiveRow`, `SegmentedLinks`, `LiveControls`, `useHolds`, `ChartCard`, `ShareBar`, `Legend`, `StatTile figure`, `DataTable live`, `LiveValue`; E3's `useRetry`.
- Produces: `ValidatorsPage({ data, live }: { data: ValidatorsPageData & { anchor: Anchor; build: string }; live: LiveControls }): JSX.Element`; `validatorsMeta(data: ValidatorsPageData, ctx: MetaContext): MetaDescriptor[]` (strings from the data and `format.ts` only: `meta.ts` runs in the browser).

**Page** (§3.1 top to bottom; board `docs/superpowers/specs/2026-10-17-explorer-mock/Validators.dc.html`): breadcrumb `XRPL / Network / Validators` ("Network" → `/{net}/network`); `<h1>` "Validators", the intro, "Amendments →"; E2's `LiveRow` "Live · updates every 10 s"; the notices; `section aria-label="Network overview"` of six `StatTile figure` in `repeat(auto-fit, minmax(min(300px, 100%), 1fr))` (failed: each "—" with "Couldn't load", and one `SectionError` "the network overview" under the grid); the versions `ChartCard` with `ShareBar`, legend, and its own `table` (a swatch per row); the validators card: `<h2>`, source line `/v2/network/validators`, the scope links as E2's `SegmentedLinks` ("UNL {n}", "All {n}", `aria-current="true"`, counts left out when L failed), `<form method="get" action={hrefs.action} role="search" aria-label="Filter validators">` with the field `q` (visually hidden label "Search validators by domain or key", placeholder "Domain or key"), "Listed by" (`publisher`, "any publisher" first; only with `summary.publishers`), "Votes yes for" (`amendment`, "any amendment" first; only while A is loaded), a hidden `scope=all` when it applies, the 44 px "Apply" button; fields are uncontrolled (`defaultValue`), and `onSubmit` prevents the default and navigates to `validatorsHref(net, fields)` with `preventScrollReset`; "Clear filters" when `hrefs.clear`; the table (`DataTable live`, `minWidth` 980, keyed by master key, columns of §3.1; amendment votes as `<details>` "{n} yes" with links, or "0 yes"; last seen `RelativeTime coarse={60}`, "not seen" without one); the footer; the empty state "No validators match these filters." with the Clear link; a failed list "Couldn't load the validators" with Retry (`useRetry`). The table holds the page (`useHolds(live.onHold)("table")` on its region, E2's rules), with "Paused while you look at the table".

- [ ] **Step 1: Write the failing tests**
  - `ValidatorsPage.test.tsx` (data from `validatorsPage(…)` over `d1-samples`, rendered in a data router): every row of §3.3 (S, L, A failed); the statuses of the list (verified, not verified, not checked yet, no domain, UNL with its hidden publishers, Negative UNL, latest, incomplete, fee arrows); the scope links keep the filters; "Apply" navigates to `validatorsHref` with no redirect requested; the `<details>` lists; Xahau has no "Listed by"; filling states (versions all unknown, no fee votes, incomplete agreement, pending domains); `LiveValue` tokens on the tiles; the hold and its note.
  - `meta.test.ts`: `validatorsMeta` gives `Validators · XRPL · explorer`, §8's description, canonical and `og:*` without an image on the default view, and `noindex, follow` and none of them for `scope: "all"`.
  - `validators-bundle.test.ts` (the scanner of `account-bundle.test.ts`): `ui/pages/ValidatorsPage.tsx`, `ui/components/StatusMarks.tsx`, `ui/components/Countdown.tsx`, `domain/validators-params.ts`, `domain/amendment-ref.ts` import nothing of `app/server` and no `ripple-` package as values; `domain/validator-key.ts` is imported as a value only by routes and `app/server` files.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/ui/pages/ValidatorsPage app/server/meta test/unit/validators-bundle` → FAIL: module and export not found.
- [ ] **Step 3: Implement** the page, its CSS and `validatorsMeta`; flip the switch and update E2's top-level assertions.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS; `pnpm test --project worker test/worker/network` and `pnpm test --project worker-off` → PASS; `pnpm verify` → exit 0; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** — `git add app/ui/pages/ValidatorsPage.tsx app/ui/pages/ValidatorsPage.test.tsx app/ui/pages.css app/server/meta.ts app/server/meta.test.ts test/unit/validators-bundle.test.ts wrangler.jsonc vitest.config.ts` (plus E2's test files updated for the flip) and `git commit -m "feat(validators): the validators list's page, and VALIDATORS on for development and tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 10: Validators list, route and loader

**Files:**
- Create: `app/routes/net.validators.tsx`, `test/worker/validators-page.spec.ts`, `test/worker/validators-page-failures.spec.ts`, `test/worker/validators-off.spec.ts`
- Modify: `app/routes.ts` (`route("validators", "routes/net.validators.tsx")` after `search`), `test/worker/meta.spec.ts`, `app/ui/routes-wiring.test.tsx`, `app/ui/components/components.test.tsx` (Header), `scripts/bundle-budget.ts` and `scripts/check-bundle.test.ts` (`{ name: "validators", route: "routes/net.validators" }`; the `PAGES` entry comes with the route, because `pnpm check:bundle` reads the route's chunk from the build's manifest)

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 7, 8, 9 (`parseValidatorsParams`, `validatorsHref`, `canonicalValidatorsParams`, the client and its TTLs, the fixtures and `validators-cases.ts`, `VALIDATORS_REFRESH_MS`, `validatorsPage`, `ValidatorsPage`, `validatorsMeta`); E2's `createLiveOnScreen`, `keepLoaded`, `useLiveControls`, `anchorOf`, `navSection`, `features`, `byDeadline`/`CARD_DEADLINE_MS`/`TooLate`.
- Produces: route id `routes/net.validators` (path `validators` under `/:net`).

**Loader** (§2.2, §3.2): `requireNetwork`; `if (!network.features.validators) throw cached({ notFound: "the validators" }, "short", { status: 404 })`; `pure = parseValidatorsParams(search)`; when `pure` has no `publisher` and no `amendment` and `validatorsHref(net, pure) !== pathname + search`, `redirect(…, { headers: cacheClassHeaders("short") })` with no call. Then side by side, all with `holdFailure: true`: `lastValidated({ ttl: HOME_CALL_TTL_SECONDS })`, `validatorsSummary({ ttl: VALIDATORS_CALL_TTL_SECONDS })`, `validators({ scope: "all", limit: 1000 }, { ttl: VALIDATORS_CALL_TTL_SECONDS })`, `amendments()`; S, L and A each through `byDeadline(call, start + CARD_DEADLINE_MS)` (a `TooLate` is a failed part, "took too long"). After all settle: `lastValidated` failed → `upstreamOutage(err, "the network")`; S, L and A all failed → `upstreamOutage(firstReason, "the validators")`. `canon = canonicalValidatorsParams(pure, { publishers: S ids or null, amendments: A rows or null })`; `validatorsHref(net, canon) !== pathname + search` → one 302 `short`. Then `validatorsPage(…)`; each failed part `logProblem` + `markDegraded(context, reasons)`; `cached({ ...page, anchor: anchorOf(last), build: BUILD_ID }, "live")`.

**Route module:** `headers = forwardCacheClass`; `handle = { navSection: "network" } satisfies NetworkRouteHandle`; `meta` → `validatorsMeta`; module-level `onScreen = createLiveOnScreen({ order: (d) => d.anchor.lastValidated, merge: (next, shown) => keepLoaded(next, shown, VALIDATORS_PARTS) })` with `VALIDATORS_PARTS = ["summary", "list", "amendments"] as const`; `clientLoader` → `onScreen.reload(scope, serverLoader)`; the component: `scope = \`${net}/validators${search of validatorsHref(net, data.params)}\``, `useLiveControls(onScreen, { everyMs: VALIDATORS_REFRESH_MS })`, `useEffect(() => onScreen.show(scope, loaderData))`, `<ValidatorsPage key={scope} …/>`.

- [ ] **Step 1: Write the failing tests**
  - `validators-page-failures.spec.ts`, **in this order** (S, L and A are one key per network):
    ```ts
    it("xrpl: S, L and A all answering Cannot GET is a 503 that is not stored", …);
    it("xrpl: S Cannot GET and A 503 leave the list, without tiles, versions, Listed by or Votes yes for, and apply ?amendment= as given", …); // Date past the hold first; /xrpl/validators?amendment=XChainBridge; no-store; the footer's fee note
    it("xahau: lastValidated failing is a 503 that is not stored", …);   // lastValidated and L overridden to 503
    it("xahau: L failing keeps the filters and the chips without counts", …); // Date past the hold first
    ```
  - `validators-page.spec.ts`, **in this order**:
    ```ts
    it("xrpl: makes exactly the calls of §2.1, stored as their classes", …);  // lastValidated [kept 2 s], summary and list [kept 10 s], amendments minute; page and .data stored as live
    it("xahau: one list call serves ?scope=all, ?q= and ?amendment= in a row", …);   // canonical URLs (?scope=all, ?q=example, ?amendment=URIToken); statusesOf(mock, "GET /v2/network/validators?limit=1000&scope=all") has length 1
    it.each([["?scope=unl", ""], ["?scope=all&publisher=&amendment=&q=", "?scope=all"], ["?x=1&q=a&q=b", "?q=a"]])("redirects %s to %j with no call", …); // 302, short, mock.requests empty
    it("sends one 302 carrying both kinds of change", …);  // ?publisher=VL.RIPPLE.COM&q=%20a%20 → ?publisher=vl.ripple.com&q=a; ?amendment=<XChainBridge id, lower case> → ?amendment=XChainBridge; ?amendment=AMM → bare
    it("holds the share bar's segments and both views, and no age or countdown, in the stored HTML", …); // no / ago</, no "in ~"
    it("has Listed by on XRPL and not on Xahau", …);
    ```
  - `validators-off.spec.ts` (`worker-off`): `/xrpl/validators` and `/xahau/validators?scope=all` are 404 `short` with `mock.requests` empty.
  - `meta.spec.ts`: on the real Worker, the default view's canonical and `og:*`, and `noindex, follow` with none of them on `?scope=all`.
  - `routes-wiring.test.tsx`: the route has a `clientLoader`; the scope per view; a failed refresh keeps the page; a beat with L failed keeps the shown list (`keepLoaded`).
  - `components.test.tsx`: on `/xrpl/validators` with this route's handle, the header's Network link has `aria-current="true"` and `.is-current`.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/ui/routes-wiring app/ui/components/components`, `pnpm test --project worker test/worker/validators-page test/worker/meta` and `pnpm test --project worker-off test/worker/validators-off` → FAIL: no such route.
- [ ] **Step 3: Implement** the route module and its loader, the `routes.ts` entry and the `PAGES` entry.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's commands → PASS; `pnpm verify` → exit 0 (the bundle table shows `validators` under 150,000 B); `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** — `git add app/routes.ts app/routes/net.validators.tsx test/worker/validators-page.spec.ts test/worker/validators-page-failures.spec.ts test/worker/validators-off.spec.ts test/worker/meta.spec.ts app/ui/routes-wiring.test.tsx app/ui/components/components.test.tsx scripts/bundle-budget.ts scripts/check-bundle.test.ts` and `git commit -m "feat(validators): the validators list's route, live every 10 s" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 11: Validator, view builder

**Files:**
- Create: `app/server/validator-view.ts`
- Test: `app/server/validator-view.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5; `Loaded`; E2's `TimeSeriesData`, `Anchor`, `utcDayOf`, `tokenOf`; E3's `trailPaging`, `Paging`; E4's `extras`.
- Produces:
  ```ts
  export function agreementAxisStart(values: readonly (string | null)[]): 99 | 95 | 90 | 50 | 0;
  export function validatorPage(input: {
    network: NetworkInfo; validator: ValidatorDetail; recent: Loaded<ValidatorValidationsPage>;
    summary: Loaded<ValidatorsSummary>; amendments: Loaded<AmendmentsList>; anchor: Anchor;
  }): ValidatorLiveData;
  export function validatorHistoryPage(input: {
    network: NetworkInfo; validator: ValidatorDetail; recent: ValidatorValidationsPage; marker: string; back: readonly string[];
  }): ValidatorHistoryData;
  export type ValidatorPageData = ValidatorLiveData | ValidatorHistoryData;
  interface ValidatorLiveData {
    kind: "live"; network: NetworkInfo; key: string;                     // key: the master key
    identity: ValidatorIdentity;                                          // shared with the history view
    grid: { signingKey: string | null; manifest: string | null; version: { text: string; latest: boolean } | null;
            firstSeen: string | null; lastSeenFallback: { at: number; ledger: { text: string; href: string } | null } | null;
            accounts: { address: string; href: string }[] | null };
    agreement: { tiles: { label: string; value: string; sub: string; incomplete: boolean }[]; chart: TimeSeriesData; table: DailyRow[]; notes: string[] };
    fees: { voteLedger: { text: string; href: string } | null; votes: { setting: string; vote: string }[] | null };
    votes: { ledger: { text: string; href: string } | null; rows: { id: string; label: { text: string; mono: boolean }; href: string; vote: "yes" | "no" | "none"; word: string }[] };
    summary: { state: "ok"; membership: { publisher: string; listed: boolean }[]; negativeSince: { text: string; href: string } | null;
               now: { now: string; against: "higher" | "lower" | "same" }[] | null } | { state: "failed" };
    amendments: { state: "ok"; status: Record<string, AmendmentStatusView>; flagInterval: number } | { state: "failed" };
    recent: { state: "ok"; rows: ValidationRowView[]; paging: Paging; newest: { at: number; ledger: { text: string; href: string } } | null } | { state: "failed" };
    meta: { name: string; publishers: string[]; version: string | null; domain: "verified" | "unverified" | null };
  }
  interface ValidatorHistoryData { kind: "history"; network: NetworkInfo; key: string; identity: ValidatorIdentity; recent: { state: "ok"; rows: ValidationRowView[]; paging: Paging } }
  ```
  `ValidatorIdentity` = heading `{ text, mono }` (domain or `shortHash(master)`), `domainStatus`, `unl`, `unlPublishers`, `negativeUnl`, `note: TextPart[] | null` (`verificationNote`), `masterKey`. `ValidationRowView` = `{ key: \`${ledger_index}:${ledger_hash}\`; ledger: { text, href }; hash: string; signed: string; full: boolean; validated; validatedShort? }`. `DailyRow` = Day (UTC), Agreement, Validated ledgers, Missed, Partial, Complete ("yes" / "no, hours missing"), newest first.

**Rules** (§4.1 to §4.3 verbatim, with these values): manifest "{n} signing keys seen by the data API" ("one signing key seen" for 1); first seen "{formatDate(first_seen)} · first seen by the data API"; the last-seen fallback from D's `last_seen` and `current_index` (the page uses `recent.newest` when VV loaded); membership: every publisher of S, listed or not (without S the page shows `unlPublishers` as listed, or "On no default list"); "On the negative UNL since ledger #N" from S `negative_unl[].first_ledger`; agreement tiles "Agreement, 1 h", "24 h", "30 days" with `scoreText` and `ledgersText`, "—" and "No validated ledgers counted yet" without a score; the chart: `axis { unit: "day", buckets: dates }`, one series slot 1, values `score × 100` to 2 decimals or `null`, `format: { kind: "percent" }`, `domain.min` `agreementAxisStart`, `forming` when the newest date is `utcDayOf(anchor.closeTime)`, `extras: [{ id: "ledgers", label: "Ledgers", tooltip: "value", values: ledgersText(day) + " · incomplete" for an incomplete day }]`, `token`; notes "Share of the validated ledgers this validator signed with the same hash. Partial validations do not count toward agreement.", "Incomplete days are missing some hours of the data API's record." when any is, and "The axis starts at {start}%."; the fee rows Base reserve, Owner reserve (`nativeText`) and Base fee (`dropsText`), or `null` without `fee_vote`; the vote rows from D's `amendment_votes.votes[]` in D's order, `word` = `statusWord(status)` (shown without A); recent rows signed `HH:MM:SS` of `signing_time`, with `"{formatUtcDay(day)}, "` before it when its UTC day is not the newest row's; paging `trailPaging({ marker, back, next: marker of VV }, (to) => validatorHref(net, key, to))`.

- [ ] **Step 1: Write the failing tests** — `validator-view.test.ts`, the list of "Testing" for this file:
  ```ts
  it.each([[["99.00", "100.00"], 99], [["98.99"], 95], [["94.90"], 90], [["49.00"], 0], [["0.00"], 0], [["50.00", null], 50]])("the axis of %j starts at %i", …);
  it.each(VERIFICATION_STATUSES)("writes the verification note for %s", …);   // the file name linked only for a verified TOML on the validator's own domain
  it("lists every publisher as listed or not with S, and unl_lists alone without S", …);
  it("takes last seen from VV, and falls back to D", …);
  it("says one signing key and n signing keys", …);
  it("writes agreement tiles without a score", …);
  it("builds the daily chart: values, gaps, forming, the Ledgers extra, the table newest first", …);
  it("writes fee votes with and without a record, and Now only with S", …);
  it("lists D's amendment votes with an unknown amendment as Yes, No and No recent vote, with A's status and with D's word", …);
  it("lists the accounts a verified domain lists, skipping an invalid address", …);
  it("writes signed times with the date prefix only across a day, and the three validated states", …);
  it("pages with trailPaging and validatorHref", …);
  it("builds the history view with nothing live in it", …);
  ```
- [ ] **Step 2: Run it to verify it fails** — `pnpm test app/server/validator-view` → FAIL.
- [ ] **Step 3: Implement** `validatorPage`, `validatorHistoryPage` and `agreementAxisStart`.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add app/server/validator-view.ts app/server/validator-view.test.ts` and `git commit -m "feat(validators): the view builder of the validator page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 12: Validator, route and page

**Files:**
- Create: `app/routes/net.validators.$key.tsx`, `app/ui/pages/ValidatorPage.tsx`, `app/ui/pages/ValidatorPage.test.tsx`, `test/worker/validator-page.spec.ts`
- Modify: `app/routes.ts` (`route("validators/:key", "routes/net.validators.$key.tsx")`), `app/server/meta.ts` (`validatorMeta`; `ImageKind` gains `"validator"`), `app/server/meta.test.ts`, `test/worker/meta.spec.ts`, `test/worker/validators-off.spec.ts`, `app/ui/routes-wiring.test.tsx`, `test/unit/validators-bundle.test.ts`, `app/ui/pages.css`, `scripts/bundle-budget.ts` and `scripts/check-bundle.test.ts` (`{ name: "validator", route: "routes/net.validators.$key" }`)
- Modify: `app/server/cache-class.ts` (the `live-home` comment) and `README.md` ("The cache classes": append the validator page to E2's cumulative `live-home` list)

**Interfaces:**
- Consumes: Tasks 1–7, 11; `isMarker`; E3's `parseTrail`; `upstreamFailure`, `upstreamOutage`; E2's live pieces.
- Produces: route id `routes/net.validators.$key`; `validatorMeta(data: ValidatorPageData, ctx: MetaContext): MetaDescriptor[]`; `ValidatorPage({ data, live }: { data: ValidatorLiveData & { anchor: Anchor; build: string }; live: LiveControls })`; `ValidatorHistoryPage({ data }: { data: ValidatorHistoryData })`.

**Loader** (§1.2, §1.4, §4.3, §4.5), in order:
1. `requireNetwork`; switch off → 404 `short` "the validators", no call.
2. `parsed = parseValidatorKey(params.key)`; `null` → `throw cached({ notFound: \`validator ${raw.slice(0, 40)}\` }, "short", { status: 404 })`; `from: "hex"` → 302 to `/{net}/validators/{base58}` + the request's own query string, `cacheClassHeaders("immutable")`, no call.
3. `marker = search.get("marker")`: present and `!isMarker(marker)` → 404 `short` "that page of the validator's validations"; `back = parseTrail(search.get("back"))`; `validatorHref(net, key, marker ? { marker, back } : {})` ≠ the request → 302 `short`, no call.
4. No marker: side by side, all `holdFailure: true`, `lastValidated({ ttl: HOME_CALL_TTL_SECONDS })`, `validator(key, { ttl: VALIDATORS_CALL_TTL_SECONDS })`, `validatorValidations(key, { limit: 20 }, { ttl: VALIDATIONS_CALL_TTL_SECONDS })`, `validatorsSummary({ ttl: VALIDATORS_CALL_TTL_SECONDS })`, `amendments()`; VV, S and A through `byDeadline`. With a marker: `validator(…)` and `validatorValidations(key, { limit: 20, marker })` only.
5. After all settle: `lastValidated` failed → `upstreamOutage(err, "the network")`. D failed: `not_found` → `upstreamFailure(err, \`validator ${shortHash(key)}\`, { href: \`/${other}/validators/${key}\`, label: \`Look for it on ${otherName}\` })`; anything else (400, 5xx, timeout, `Cannot GET`) → `upstreamOutage(err, "the validator")`.
6. `validator.validation_public_key !== key` → 302 to `validatorHref(net, master, { marker, back })`, `cacheClassHeaders("slow")`.
7. Marker view: VV `bad_request` or no rows → 404 `short` "that page of the validator's validations"; any other VV failure → `upstreamOutage`; `cached(validatorHistoryPage(…), "slow", { ttl: 300 })`.
8. Live view: `validatorPage(…)`, failed parts logged and `markDegraded`; `cached({ ...page, anchor, build }, "live-home")`.

**Route module:** `headers`, `handle = { navSection: "network" }`, `meta`; `onScreen = createLiveOnScreen({ order: (d) => d.anchor.lastValidated, merge: (next, shown) => keepLoaded(next, shown, VALIDATOR_PARTS) })`, `VALIDATOR_PARTS = ["recent", "summary", "amendments"] as const`; `clientLoader({ request, serverLoader })` returns `serverLoader()` straight when the URL has a `marker`, else `onScreen.reload(\`${net}/validators/${key}\`, serverLoader)`; the component renders `ValidatorHistoryPage` for `kind: "history"` (no `useLiveControls`, no live row), else a child that calls `useLiveControls(onScreen)` and `onScreen.show` and renders `ValidatorPage key={scope}`.

**Page** (§4.1; board `Validator.dc.html`): breadcrumb `XRPL / Network / Validators / {heading}`; `LiveRow` "Live · updates every ledger"; identity (`section aria-label="Validator"`): "Validator" over the `<h1>`, the marks, the note, the source line, "Master public key" in full with `CopyButton` "Copy master public key", the grid (`repeat(auto-fit, minmax(min(240px, 100%), 1fr))`) of §4.1 (signing key short with copy and the full key as `title`; last seen precise `RelativeTime` from `recent.newest`, else `coarse={60}` from the fallback, with "last validation, ledger #N"; "Accounts {domain} lists" only with accounts); agreement tiles (`section aria-label="Agreement"`); the daily `ChartCard` "Daily agreement with validated ledgers, last 30 days" (`LineChart`, end dot, no area, `extreme="lowest"`, its own `table`); "Fee votes" (Now and Against now "—" without S, with the note of §4.1; "No fee vote recorded in the last 24 hours."); "Amendment votes" with "All amendments →" (status `AmendmentStatusPill`, or "Voting · {share} yes", or D's word); "Recent validations" (`DataTable live`, `minWidth` 720, keyed by `key`, footer "Newest first. Partial validations do not count toward agreement. The data API keeps 7 days." and `Pager`). The history view: breadcrumb, `<h1>` with its marks, and the Recent validations card only.

- [ ] **Step 1: Write the failing tests**
  - `ValidatorPage.test.tsx`: every row of §4.4 (VV, S, A failed); every status of §2.5 on the page; the verification note with its link; the copy buttons; the Pager; the history view has no live row, no tiles and no other card; Xahau "build N"; filling states (no vote record, incomplete 30 days, pending domain).
  - `validator-page.spec.ts`, **in this order** (keys from `validatorCase`/`fixtureValidatorKeys`, a new one per test; S and A are one key per network):
    ```ts
    it("xrpl: lastValidated failing is a 503 that is not stored", …);              // lastValidated 503 and S Cannot GET
    it("xrpl: S Cannot GET degrades fee Now and UNL membership", …);               // Date past the hold first; 200, no-store
    it("xahau: A failing leaves D's status words and 'on flag ledgers'", …);
    it("xrpl: a failing VV is held: two renders within 5 s make one request", …);  // Date past the S hold first; statusesOf length 1; "Couldn't load the recent validations"; last seen from D
    it("xrpl: VV past 4.5 s fails its card with took too long", …);               // override answering after 4,600 ms
    it("a key D does not know is a 404 short with the offer of the other network", …); // link /xahau/validators/{key}; stored 30 s
    it.each([["Cannot GET", dataApiError(404, "Cannot GET /v2/network/validators/K")], ["a 400", dataApiError(400, "invalid validator public key")]])("D answering %s is a 503", …);
    it("is live-home, page and .data, with exactly lastValidated, D, VV, S and A", …);
    it("redirects 66 hex to base58, immutable, keeping the query, with no call", …);
    it("redirects a signing key to its master, slow, keeping marker and back", …);
    it.each(["summary", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", "nHUkp7"])("%s is a 404 short with no call", …);
    it.each([["?x=1", ""], ["?back=M1", ""]])("tidies %s with no call", …);
    it("serves a marker page: slow 300 s, noindex, no canonical, only D and VV", …);
    it.each(["?marker=!!", "VV 400", "an empty page"])("%s is a 404 short", …);
    it("holds no age in the stored HTML", …);
    ```
  - `validators-off.spec.ts`: `/xrpl/validators/{key}` is a 404 `short` with no call.
  - `meta.test.ts` / `meta.spec.ts`: §8's title and description (on the UNL with its publishers, running {software} {version}, verified / not verified / nothing for a pending or absent domain), `og:image` `/og/{net}/validator/{master}.png`; marker pages `noindex, follow` without canonical or `og:*`.
  - `routes-wiring.test.tsx`: the live view polls, keeps a failed beat's VV part, and the marker view never calls `onScreen` and never polls.
  - `validators-bundle.test.ts` gains `ui/pages/ValidatorPage.tsx`.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/ui/pages/ValidatorPage app/server/meta app/ui/routes-wiring test/unit/validators-bundle`, `pnpm test --project worker test/worker/validator-page test/worker/meta` and `pnpm test --project worker-off test/worker/validators-off` → FAIL.
- [ ] **Step 3: Implement** the route, both page components, `validatorMeta`, the CSS, the route entry, the `PAGES` entry, the `live-home` comment and README line.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's commands → PASS; `pnpm verify` → exit 0; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** — `git add app/routes.ts app/routes/net.validators.\$key.tsx app/ui/pages/ValidatorPage.tsx app/ui/pages/ValidatorPage.test.tsx app/ui/pages.css app/server/meta.ts app/server/meta.test.ts app/server/cache-class.ts README.md test/worker/validator-page.spec.ts test/worker/meta.spec.ts test/worker/validators-off.spec.ts app/ui/routes-wiring.test.tsx test/unit/validators-bundle.test.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts` and `git commit -m "feat(validators): the validator page, live every ledger, with its older validations" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 13: Amendments list

**Files:**
- Create: `app/server/amendments-view.ts`, `app/server/amendments-view.test.ts`, `app/routes/net.amendments.tsx`, `app/ui/pages/AmendmentsPage.tsx`, `app/ui/pages/AmendmentsPage.test.tsx`, `test/worker/amendments-page.spec.ts`
- Modify: `app/routes.ts` (`route("amendments", "routes/net.amendments.tsx")`), `app/server/meta.ts` (`amendmentsMeta`), `app/server/meta.test.ts`, `test/worker/meta.spec.ts`, `test/worker/validators-off.spec.ts`, `app/ui/routes-wiring.test.tsx`, `test/unit/validators-bundle.test.ts`, `app/ui/pages.css`, `scripts/bundle-budget.ts`, `scripts/check-bundle.test.ts` (`{ name: "amendments", route: "routes/net.amendments" }`)

**Interfaces:**
- Consumes: Tasks 1–7; E2's `Meter` (`small`), `LiveRow` and `SegmentedLinks`; E3's `Meter decorative` and `minute`.
- Produces:
  ```ts
  export function amendmentsPage(input: { network: NetworkInfo; amendments: AmendmentsList; status?: AmendmentStatus }): AmendmentsPageData;
  export interface AmendmentsPageData {
    network: NetworkInfo; status?: AmendmentStatus; intro: string; hrefs: { validators: string };
    activating: { name: { text: string; mono: boolean }; href: string; line: TextPart[]; under: string }[];
    rules: TextPart[];
    chips: { label: string; count: number; href: string; current: boolean }[];
    rows: AmendmentListRow[]; footer: string[];
  }
  ```
  `AmendmentListRow` = `{ id; rank; name: { text, mono }; href; xls: { text: string; href: string | null } | null; retired: boolean; introduced: string; meter: { data: MeterData; text: string } | null; status: AmendmentStatusView; enabled: { date: string; ledger: { text, href } | null } | "always" | null }`.

**Rules** (§5.1, §5.2 verbatim): rows in A's order, the chosen status only, every row (no paging); rank = position in the list shown; meters for `majority`, `voting`, `unknown` only (`value` `yesPercentValue`, `max` "100", `threshold { value: String(threshold_percent), label: "80%" }`, text "{yesPercentText} · {yes} / {trusted} UNL"); "Enabled on" `formatDate(enabled.date)` over a ledger link (no link from metadata), "Always on" for a retired one (visually hidden "retired: always on, not listed in the ledger"); the activating line `[\`${name} activates on or soon after ${formatDateTime(expected_activation)}\`, { countdown: { at, fallback: "", past: "at the next flag ledger", lead: ", " } }, \`, if it keeps ${moreThan(threshold_percent)}\`]` and under it "{yes} of {trusted} UNL validators vote yes · majority since {formatDate(since)}, held for {majority_hold_seconds ÷ 86,400} days before it activates"; the rules paragraph of §5.1 with `{ countdown: { at, fallback: "expected HH:MM UTC", past: "due now", approx: true } }` after "Next flag ledger #{n} " (never a link); chips All, Activating, Voting, Activated, Obsolete, and Unknown only when `counts.unknown > 0`, each with its count; footer "{n} amendments" · "the tick on each bar marks 80%".

**Loader:** `requireNetwork`; switch off → 404; `parseAmendmentsParams`, non-canonical → 302 `short`, no call; `lastValidated({ ttl: HOME_CALL_TTL_SECONDS, holdFailure: true })` and `amendments({ holdFailure: true })` side by side, neither raced; either failed → `upstreamOutage` (A: "the amendments"); `cached({ ...page, anchor, build }, "minute")`. **Route:** `handle = { navSection: "network" }`; `onScreen = createLiveOnScreen({ order: (d) => d.anchor.lastValidated })` (no merge); scope `${net}/amendments${search}`; `useLiveControls(onScreen, { everyMs: AMENDMENTS_REFRESH_MS })`. **Page** (board `Amendments.dc.html`): breadcrumb `XRPL / Network / Amendments`, `<h1>`, intro, "Validators →", `LiveRow` "Live · updates every minute", "Activating soon" (`section aria-label="Activating soon"`, accent border; left out when empty), the rules, the chips as E2's `SegmentedLinks` (`aria-current="true"`), `DataTable live` (`minWidth` 1000, 56 px rows, keyed by ID; `Meter small decorative`), footer.

- [ ] **Step 1: Write the failing tests**
  - `amendments-view.test.ts`: order and status filter; rank; meters only for the three statuses; retired rows; enabled from the ledger and from metadata; activating lines for 0, 1 and 2 majorities; the rules paragraph from `rules` (XRPL 14 days, Xahau 5); the Unknown chip only with `counts.unknown > 0`.
  - `AmendmentsPage.test.tsx`: every status pill; the XLS tag as a link and as text; the chips as links; the countdowns' server text.
  - `amendments-page.spec.ts`, **in this order**: xrpl A `Cannot GET` → 503 not stored; xahau A 503 → 503; the page and `.data` stored as `minute` with exactly `lastValidated` and A; `?status=VOTING` → `?status=voting` and `?status=all` → bare, both 302 `short` with no call; the stored HTML holds "expected" and no "in ~".
  - `validators-off.spec.ts`: `/xrpl/amendments` 404 `short`, no call. `meta`: title `Amendments · XRPL · explorer`, §8's description, default indexable, `?status=` `noindex, follow`. `routes-wiring`: the route polls every minute. `validators-bundle.test.ts` gains `ui/pages/AmendmentsPage.tsx` and `domain/amendments-params.ts`.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/server/amendments-view app/ui/pages/AmendmentsPage app/server/meta app/ui/routes-wiring test/unit/validators-bundle`, `pnpm test --project worker test/worker/amendments-page test/worker/meta`, `pnpm test --project worker-off test/worker/validators-off` → FAIL.
- [ ] **Step 3: Implement** the builder, the route, the page, `amendmentsMeta`, the CSS, the route and `PAGES` entries.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's commands → PASS; `pnpm verify` → exit 0; `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** — `git add app/routes.ts app/routes/net.amendments.tsx app/server/amendments-view.ts app/server/amendments-view.test.ts app/ui/pages/AmendmentsPage.tsx app/ui/pages/AmendmentsPage.test.tsx app/ui/pages.css app/server/meta.ts app/server/meta.test.ts test/worker/amendments-page.spec.ts test/worker/meta.spec.ts test/worker/validators-off.spec.ts app/ui/routes-wiring.test.tsx test/unit/validators-bundle.test.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts` and `git commit -m "feat(amendments): the amendments list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 14: Amendment, view builder

**Files:**
- Create: `app/server/amendment-view.ts`
- Test: `app/server/amendment-view.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5; E2's `TimeSeriesData`, `MeterData`, `tokenOf`; E4's `extras`.
- Produces:
  ```ts
  export function yesVotesPageStep(rounds: readonly AmendmentRoundPoint[]): number;  // rounds whose date is within 24 h of the newest round's
  export function amendmentPage(input: { network: NetworkInfo; amendment: AmendmentDetail; summary: Loaded<ValidatorsSummary> }): AmendmentPageData;
  export interface AmendmentPageData {
    network: NetworkInfo; canonical: string;                    // amendmentSegment(row)
    identity: { heading: string; id: string; status: AmendmentStatusView; grid: { label: string; value: TextPart[] }[]; description: string | null };
    consensus: {
      votes: { figure: string; meter: MeterData; sentences: TextPart[][] } | null;   // null for enabled and obsolete
      chart: (TimeSeriesData & { pageStep: number }) | null;                        // null without rounds: "No voting rounds recorded in the last 30 days."
      table: { from: { text: string; href: string }; date: string; yes: string; share: string; passes: boolean }[];
      notes: string[];
    } | null;                                                                         // null: enabled or obsolete without rounds
    history: { pending: { when: string; countdown: { at: number } } | null; events: HistoryItem[]; note: string };
    unlVotes: VoteRowView[]; otherVotes: VoteRowView[];
    counts: { yes: number; no: number; none: number; otherYes: number };
    summary: { state: "ok"; publishers: string[]; othersSeen: number } | { state: "failed" };
    meta: { title: string; description: string };              // §8's, built here as strings
  }
  ```
  `VoteRowView` = `{ key; name: { text, mono }; href; vote; version: string | null; lacks: boolean; lastSeen: number | null }`. `HistoryItem` = `{ event: "got_majority" | "lost_majority" | "enabled"; label; date: string; ledger: { text, href }; tx: { text: "EnableAmendment {short}"; href } | null }`, newest first.

**Rules** (§6.1 to §6.5 verbatim): identity grid per status ("Specification" XLS tag via `xlsLink`, else "No XLS" plus " · fix amendments have none" for a name starting with `fix`; "Introduced in" "{software} {introduced}" or "Not known"; `majority`: "Majority since" and "Activates on"; `enabled`: "Enabled on" `formatDateTime` with ledger and transaction links, or "before the indexed history" for `metadata`, and for a retired one "Always on: {software} applies it although the ledger does not list it"; `obsolete` and `unknown` sentences of §6.1); the heading "Unknown amendment" for a nameless one; consensus for `majority`, `voting`, `unknown` (§6.2), and for `enabled`/`obsolete` the chart and table only, when `rounds` is not empty, else `null`:
- **Sentence 1:** yes ≥ needed: "{yes} of {trusted} UNL validators vote yes; {needed} are needed."; otherwise "…; {needed − yes} more are needed." ("1 more is needed." for one); with `trusted < round.unl_size`: "{yes} of the {trusted} UNL validators with a recent vote vote yes; …".
- **Sentence 2:** `majority`: "{spare} can change their vote before it loses majority." (spare = yes − needed), "One vote less and it loses majority." at 0, then "Majority since {formatDate(since)} at ledger #{n}; activates on or soon after {formatDateTime(expected_activation)} if it holds." (no " at ledger #{n}" without `majority.ledger_index`; the ledger a link); `voting`/`unknown`: "Votes of voting ledger #{V}, {formatDateTime(round.date)}."
- **Figure and meter:** `yesPercentText`; `MeterData { value: yesPercentValue ?? "0", max: "100", threshold: { value: String(threshold_percent), label: "80%" }, label: "{yes} of {trusted} UNL validators vote yes, {pct}; more than 80% needed" }`.
- **Chart:** `axis { unit: "flag", buckets: rounds' date }`, slot 1, values `yesPercentValue` (null for trusted 0), `domain.min` "50", or "0" when a round is lower; `references: [{ value: String(threshold_percent), label: "80% threshold" }]`; `extras: [{ id: "round", label: "Round", tooltip: "value", values: "flag ledger #{flag_ledger} · {yes} of {trusted} UNL validators · majority" (or "no majority") }]`; `pageStep` `yesVotesPageStep`; `token`. Table: the first round and each where `yes` or `trusted` changed, newest first. Notes "One point per flag ledger, every {flag_interval} ledgers. The axis starts at {50|0}%." and "One row per change in the yes count; the count holds until the next row."; without rounds `chart` is `null`, the table empty, and the page says "No voting rounds recorded in the last 30 days."
- **History:** for `majority` the pending item ("Enabled, expected", `{formatDateTime(expected_activation)}, if the majority holds`, a countdown, "No transaction yet"); each event with "Got majority" / "Lost majority" / "Enabled"; a `metadata`-only enabled amendment one item "Enabled {date}{, ledger #n}" with "Before the indexed history"; note "Each change of majority is an EnableAmendment pseudo-transaction, in the ledger after a flag ledger."
- **Votes:** `unl_votes` and `other_votes` in D1's order; `lacks` when `version_supports === false`.

- [ ] **Step 1: Write the failing tests** — `amendment-view.test.ts`, the list of "Testing" for this file:
  ```ts
  it.each(["majority", "voting", "enabled", "enabled from metadata", "retired", "obsolete", "unknown"])("writes the identity grid of %s", …);
  it.each([
    [{ yes: 4, trusted: 35, needed: 29 }, "4 of 35 UNL validators vote yes; 25 more are needed."],
    [{ yes: 29, trusted: 35, needed: 29 }, "29 of 35 UNL validators vote yes; 29 are needed."],
    [{ yes: 31, trusted: 35, needed: 29 }, "31 of 35 UNL validators vote yes; 29 are needed."],
    [{ yes: 0, trusted: 1, needed: 1 }, "0 of 1 UNL validators vote yes; 1 more is needed."],
  ])("sentence 1 for %j", …);
  it("says 'of the 33 UNL validators with a recent vote' when trusted is under unl_size", …);
  it("shows — and a null series value for trusted 0", …);
  it("says the spare votes, and 'One vote less and it loses majority.' at 0", …);   // yes 31, needed 29 → "2 can change their vote before it loses majority."
  it("writes the majority sentence and history with and without majority.ledger_index and tx_hash", …);
  it("links the XLS only on github.com under /XRPLF/XRPL-Standards/", …);
  it("builds the step series with its Round extra, 80% reference and pageStep from the newest 24 h", …);
  it("starts the axis at 50%, or at 0% when a round is lower", …);
  it("keeps only the changes in the chart table: yes changes, trusted changes, the first round", …);
  it("lists history newest first, with the pending item for a majority", …);
  it("writes vote counts, with publishers and others seen only with S", …);
  it("marks a validator whose version lacks it", …);
  it.each(STATUSES)("writes §8's title and description for %s", …);
  ```
- [ ] **Step 2: Run it to verify it fails** — `pnpm test app/server/amendment-view` → FAIL.
- [ ] **Step 3: Implement** `amendmentPage` and `yesVotesPageStep`.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's command → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add app/server/amendment-view.ts app/server/amendment-view.test.ts` and `git commit -m "feat(amendments): the view builder of the amendment page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 15: Amendment, route and page

**Files:**
- Create: `app/routes/net.amendments.$name.tsx`, `app/ui/pages/AmendmentPage.tsx`, `app/ui/pages/AmendmentPage.test.tsx`, `test/worker/amendment-page.spec.ts`
- Modify: `app/routes.ts` (`route("amendments/:name", "routes/net.amendments.$name.tsx")`), `app/server/meta.ts` (`amendmentMeta`; `ImageKind` gains `"amendment"`), `app/server/meta.test.ts`, `test/worker/meta.spec.ts`, `test/worker/validators-off.spec.ts`, `app/ui/routes-wiring.test.tsx`, `test/unit/validators-bundle.test.ts`, `app/ui/pages.css`, `scripts/bundle-budget.ts`, `scripts/check-bundle.test.ts` (`{ name: "amendment", route: "routes/net.amendments.$name" }`)

**Interfaces:**
- Consumes: Tasks 1–7, 14; E2's `LineChart`, `Meter`, `ChartCard`, live pieces; E3's `useRetry`.
- Produces: route id `routes/net.amendments.$name`; `amendmentMeta(data: AmendmentPageData, ctx: MetaContext): MetaDescriptor[]`; `AmendmentPage({ data, live })`.

**Loader** (§1.3, §6): `requireNetwork`; switch off → 404; `ref = parseAmendmentRef(params.name)`, `null` → 404 `short` "amendment {first 40 characters}", no call; a non-empty query string → 302 `short` to `/{net}/amendments/{params.name, or the upper-cased ID}`, no call; side by side, all `holdFailure: true`: `lastValidated({ ttl: HOME_CALL_TTL_SECONDS })`, `amendment(ref.id ?? ref.name)`, `validatorsSummary({ ttl: VALIDATORS_CALL_TTL_SECONDS })` (S through `byDeadline`; A is never called); `lastValidated` failed → `upstreamOutage`; AD `not_found` → `upstreamFailure(err, \`amendment ${name, or shortHash(id)}\`, { href: \`/${other}/amendments/${params.name}\`, label: \`Look for it on ${otherName}\` })`, any other AD failure → `upstreamOutage(err, "the amendment")`; `amendmentSegment(row) !== params.name` → 302 to it, `cacheClassHeaders("slow")`; `cached({ ...page, anchor, build }, "minute")`. **Route:** `handle = { navSection: "network" }`; `merge: keepLoaded(next, shown, ["summary"])`; scope `${net}/amendments/${canonical}`; `everyMs: AMENDMENTS_REFRESH_MS`.

**Page** (§6; board `Amendment.dc.html`): breadcrumb `XRPL / Network / Amendments / {name or short ID}` in mono; `LiveRow` "Live · updates every minute"; identity (`section aria-label="Amendment"`, `<h1 class="mono">`, status pill, source line, "Amendment ID" with "Copy amendment ID", the grid, the description with the tag "hand-kept metadata, not read from the ledger"); Consensus (44 px figure, 12 px `Meter`, the sentences, the `ChartCard` "Yes votes per flag ledger, % of the UNL, last 30 days" with `LineChart curve="step"`, `pageStep`, its own `table`); History (`<ol>`, dots `aria-hidden`: got filled `--series-1`, lost outlined `--border-strong`, enabled filled `--ok` with a check, pending dashed); "Votes of the UNL validators" (head "{yes} yes · {no} no{ · {none} without a recent vote}{, on {joinAnd(publishers)}}", `DataTable live maxHeight={470}` with a sticky head, `minWidth` 640, keyed by key, last seen `RelativeTime coarse={300}`); "Other validators, not on the UNL" as a closed `<details>` with a 48 px `<summary>` and the footer of §6.5 (without S, no "of the N … seen").

- [ ] **Step 1: Write the failing tests**
  - `AmendmentPage.test.tsx`: each status's identity; the sentences; the chart and its changes-only table; history with the pending item; vote heads with and without S; the closed disclosure; "its version lacks it"; the Xahau "Always on" and 5 days; the empty consensus card.
  - `amendment-page.spec.ts`, **in this order**:
    ```ts
    it("xrpl: lastValidated failing is a 503 that is not stored", …);
    it("xrpl: S Cannot GET leaves out 'on {publishers}' and 'of the N … seen'", …);    // Date past the hold first; 200, no-store
    it("an amendment the network does not know is a 404 short with the offer of the other network", …);  // /xahau/amendments/XChainBridge → "Look for it on XRPL"
    it("AD answering Cannot GET is a 503", …);
    it("redirects a case variant, slow", …);            // "amm" (override with AMM's body) → /xrpl/amendments/AMM
    it("redirects the lower-case ID of a named amendment to its name, slow", …);
    it("redirects the lower-case ID of a nameless amendment to the upper-case ID, slow", …);
    it.each(["fix-1201", "a".repeat(65)])("%s is a 404 with no call", …);
    it("sends any query string to the bare path, short, with no call", …);
    it("is minute, page and .data, with exactly lastValidated, AD and S", …);
    it("keeps the full 30-day page under 150,000 B gzipped", …);   // XRPL majority amendment, gzip via CompressionStream
    it("holds no age or countdown in the stored HTML", …);
    ```
  - `validators-off.spec.ts`: `/xrpl/amendments/AMM` 404 `short`, no call. `meta`: §8 per status, `og:image` `/og/{net}/amendment/{canonical}.png`. `routes-wiring`: keeps a failed beat's S part. `validators-bundle.test.ts` gains `ui/pages/AmendmentPage.tsx`.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/ui/pages/AmendmentPage app/server/meta app/ui/routes-wiring test/unit/validators-bundle`, `pnpm test --project worker test/worker/amendment-page test/worker/meta`, `pnpm test --project worker-off test/worker/validators-off` → FAIL.
- [ ] **Step 3: Implement** the route, the page, `amendmentMeta` (from `data.meta`), the CSS, the route and `PAGES` entries.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's commands → PASS; `pnpm verify` → exit 0 (`amendment` under 150,000 B in the bundle table); `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** — `git add app/routes.ts app/routes/net.amendments.\$name.tsx app/ui/pages/AmendmentPage.tsx app/ui/pages/AmendmentPage.test.tsx app/ui/pages.css app/server/meta.ts app/server/meta.test.ts test/worker/amendment-page.spec.ts test/worker/meta.spec.ts test/worker/validators-off.spec.ts app/ui/routes-wiring.test.tsx test/unit/validators-bundle.test.ts scripts/bundle-budget.ts scripts/check-bundle.test.ts` and `git commit -m "feat(amendments): the amendment page, its votes, rounds and history" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 16: Link-preview images of validators and amendments

**Files:**
- Modify: `app/routes/og.$net.$kind.$id[.png].tsx` (kinds `validator` and `amendment`), `app/server/card-data.ts` (`validatorCard`, `amendmentCard`)
- Test: `app/server/card-data.test.ts`, `test/worker/og.spec.ts`, `test/worker/validators-off.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5; the route's `notFound`, `unavailable`, `permanent`, `image`.
- Produces:
  ```ts
  export function validatorCard(detail: ValidatorDetail, network: NetworkBrief & { software: Network["software"] }): CardData;
  export function amendmentCard(detail: AmendmentDetail, network: NetworkBrief & { software: Network["software"] }): CardData;
  ```
  Validator: kind "Validator"; headline the domain (sans) or `shortHash(master)` (mono); `parties: [master]`; note the parts that apply joined by " · ": "On the default UNL", "domain verified", "{software} {version}"; footer `[{ text: network.name }]`. Amendment: kind "Amendment"; headline the name or `shortHash(id)`, mono; note "Enabled on {formatDate}", "Majority since {formatDate(since)} · activates on or soon after {formatDate(expected_activation)}", "Voting · {yes} of {trusted} UNL validators vote yes", "Obsolete", "Unknown amendment"; footer "XLS-30 · introduced in {software} 1.12.0" (the parts that apply; an empty list leaves `[{ text: network.name }]`); `footerEnd` `shortHash(id)`. `card.tsx` is unchanged.

**Route** (§8 "Images"): the existing query-string redirect first; switch off → `notFound()` before any call. `validator`: `parseValidatorKey`; `null` → `notFound()`; hex → `permanent(base58 URL)`; `api.validator(key, { ttl: VALIDATORS_CALL_TTL_SECONDS })`; `not_found` → `notFound()`; any other failure, `Cannot GET` and 400 included → `unavailable(retryAfter)`; a signing key → 302 `slow` to `/og/{net}/validator/{master}.png`; `image(validatorCard(…), request, "slow")`. `amendment`: `parseAmendmentRef`; `null` → `notFound()`; `api.amendment(…)`; failures as above; `amendmentSegment(row) !== id` → 302 `slow` to `/og/{net}/amendment/{canonical}.png`; `image(amendmentCard(…), request, "slow")`.

- [ ] **Step 1: Write the failing tests**
  - `card-data.test.ts`: both cards' words for a verified UNL validator, a validator without domain, and an amendment of each status.
  - `og.spec.ts` (new keys and names; failures first): D `Cannot GET` and AD `Cannot GET` → 503 not stored; a validator and an amendment image are PNGs of 1200 × 630 (`test/support/png.ts`) stored `slow`; hex → 302 `immutable`, no call; a signing key → 302 `slow`; a lower-case ID → 302 `slow`; an invalid key or ref and D's or AD's 404 → 404 `short`; a query string → 302 to the bare path.
  - `validators-off.spec.ts`: `/og/xrpl/validator/{key}.png` and `/og/xrpl/amendment/AMM.png` are 404 `short` with no call.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/server/card-data`, `pnpm test --project worker test/worker/og`, `pnpm test --project worker-off test/worker/validators-off` → FAIL.
- [ ] **Step 3: Implement** the two cards and the two kinds.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's commands → PASS; `pnpm verify` → exit 0.
- [ ] **Step 5: Commit** — `git add 'app/routes/og.$net.$kind.$id[.png].tsx' app/server/card-data.ts app/server/card-data.test.ts test/worker/og.spec.ts test/worker/validators-off.spec.ts` and `git commit -m "feat(og): link-preview images of validators and amendments" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 17: The network page's links, the README, the bundle figures, end to end

**Files:**
- Modify: `app/server/network-view.ts` and `app/ui/pages/NetworkPage.tsx` (E2's: each "First seen" key gains `href: string | null`), `app/server/network-view.test.ts`, `app/ui/pages/NetworkPage.test.tsx`, `test/worker/validators-off.spec.ts`
- Create: `test/e2e/validators.spec.ts`, `test/e2e/amendments.spec.ts`, `test/e2e/validators-live.spec.ts`
- Modify: `test/e2e/a11y.spec.ts` (no `playwright.config.ts` change: E2's `LIVE_SPECS` takes `**/*-live.spec.ts`, so `validators-live.spec.ts` runs in the `live` project)
- Modify: `README.md` (section "Validators and amendments"; the `VALIDATORS` row of "Switches"; "The client bundle check" figures; the staging checklist)

**Interfaces:**
- Consumes: everything above; E2's `E2E_FEATURES_OFF`, `contextFor`, the fixture server's `override`.
- Produces (**Growth** of E2's `ValidatorsView`, as the E2 plan says): each `first[]` entry (`{ key, short, delay }`) gains `href: string | null`, `/{net}/validators/{key}` while `net.features.validators`, else `null`; `NetworkPage.tsx` draws a link or the text it draws today. Nothing else for later plans.

- [ ] **Step 1: Write the failing tests**
  - `network-view.test.ts` / `NetworkPage.test.tsx`: the five keys are hrefs with `VALIDATORS` on and text (`null`) with it off. `validators-off.spec.ts`: on `/xrpl/network` the five keys are text and "All validators" is "soon".
  - `validators.spec.ts` (§"Testing", "End to end"; keys read from the pages, never fixed, so the suite runs against a real stack): from the network page "All validators" lands on `/xrpl/validators?scope=all` and a first-seen key on its validator; the default list; "All" sets `?scope=all`, adds `noindex`, drops the canonical link, and Back restores them; a search through the form with JavaScript (no redirect requested) and without it (`contextFor({ javaScriptEnabled: false })`: the redirect tidies empty fields); "Votes yes for" and "Listed by" on XRPL, no "Listed by" on Xahau; Clear filters; a row leads to its validator page; the versions chart's Table radio works without JavaScript; on the validator page the copy buttons, the agreement slider's arrow keys change `aria-valuetext`, Older and Newer, and a hex key URL (made from the page's master key with `decodeNodePublic`) lands on the base58 URL. Where `E2E_FEATURES_OFF` lists `VALIDATORS`, the tests that need the pages skip themselves and the off case runs: the four pages are 404s and "All validators" is "soon".
  - `amendments.spec.ts`: the chips; the activating-soon line leads to the amendment; on the yes-votes chart Page Up moves a day (`aria-valuetext` changes by `pageStep`), the Table radio shows the changes-only table; the Other validators disclosure; a lower-case ID URL lands on the name URL; a ledger link and an EnableAmendment link lead to their pages; countdowns are absolute text with JavaScript off and tick with it on.
  - `validators-live.spec.ts` (`live` project, alone, after the others): a new validation (the fixture server's VV answer gains a row) enters the validator page's table with `.is-entering`, and only the route's `.data` URL is asked for; reduced motion moves nothing; pause and resume; the table hold; a 503 keeps the page and says "Live updates paused, retrying…" after two; with `/v2/network/amendments` overridden to 503 before the list loads, "Votes yes for" is missing and appears by itself once the override is removed (within the hold plus a beat), and an open list whose beat then fails keeps its select.
  - `a11y.spec.ts`: the matrix of "Accessibility" (the four XRPL pages at 1280 and 375 px in the four theme settings; the second list in the two system themes, every table view on, a failed card, the slider focused with its tooltip, the Other disclosure open); `landmark-unique` covers the filter form's search landmark; no page scrolls sideways at 375 px.
- [ ] **Step 2: Run them to verify they fail** — `pnpm test app/server/network-view app/ui/pages/NetworkPage`, `pnpm test --project worker-off test/worker/validators-off`, `pnpm test:e2e` → the new cases FAIL.
- [ ] **Step 3: Implement** the key links and the e2e specs. Then measure: `pnpm build && pnpm check:bundle` (the four pages' figures), and the gzip size of `build/client/assets/manifest-*.js` and of the shared base (the home figure minus its route), compared with E2's recorded figures, as E2's measurement step does; record both, with the growth for four routes, in "The client bundle check". Write the README section "Validators and amendments" (after E3's markets section): the four routes and two image kinds, `VALIDATORS` and its values (top level `"on"`, staging and production `"off"` until D1 has served that environment on both networks for at least two hours; rolling back is `"off"` and a deploy), the edge and subrequest classes of Global Constraints, the beats, the canonical queries and the fallback (an API without D1 → 503s never stored). Add to the staging checklist: the four pages on both networks and the image of a validator and of an amendment against the staging stack; the hold seen in `wrangler tail` (one failing call per 5 s per instance while a card fails); one L request per 10 s per instance whatever the filters; a page answered 503, not stored, against an API without D1; the four bundle figures.
- [ ] **Step 4: Run the tests to verify they pass** — Step 2's commands → PASS; `pnpm verify` → exit 0 (every page under 150,000 B; over 145,000 B, apply E2's fallback and say so in the README); `pnpm test:e2e` → PASS.
- [ ] **Step 5: Commit** — `git add app/server/network-view.ts app/server/network-view.test.ts app/ui/pages/NetworkPage.tsx app/ui/pages/NetworkPage.test.tsx test/worker/validators-off.spec.ts test/e2e/validators.spec.ts test/e2e/amendments.spec.ts test/e2e/validators-live.spec.ts test/e2e/a11y.spec.ts README.md` and `git commit -m "feat(network): first-seen validators link to their pages; the validators and amendments pages end to end" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
