# Explorer foundation: decisions made while building it

The plan was executed task by task, each task implemented and then reviewed. Where the spec or plan left a choice open, or turned out wrong, the controller made a ruling and kept going. This file collects those rulings so the owner can check them. Each one says what was decided, why, and what it costs if it is wrong.

## Please confirm (they change what the spec says)

1. **Older account pages are cached for 1 hour, not a year.**
   - Spec §2 says marker pages are `immutable`.
   - data-api-new's backfill (range ingest beside the live syncer), `--reprocess` and gap repair write history below the frontier. A stored older page could therefore show a stale or incomplete slice until the next deploy.
   - The class is one constant, `MARKER_PAGE_CLASS` in `app/server/cache-class.ts`. Flip it back to `immutable` once backfill is finished; its comment names the tests and README lines to update.
2. **React Router 8, not v7.** 8.4 was current when the plan was written. The spec was amended at planning time.
3. **Response types are written by hand** in `app/server/api-types.ts`. `data-api-new/docs/openapi.yaml` lists paths but no response schemas, so the generated types only check, at compile time, that each called path exists.
4. **Older account pages show history only.** They carry no live balance or state and no activation date, because those change while the page is stored. They are `noindex, follow`, with no canonical link.
5. **"Never activated" needs three things:** the index has no creation record, the node does not know the address, and the index holds no history for it. An address with history but no creation record (for example one deleted before the index begins) shows the Deleted view.
6. **Deploy configuration:**
   - `workers_dev: false` and `preview_urls: false` in staging and production.
   - No routes yet, since the hosts are not named; the README explains how to add `routes: [{ pattern, custom_domain: true }]`.
   - `scripts/predeploy-check.ts` refuses a deploy whose built config still has placeholder (`*.invalid`) or non-https upstreams, or that was built for a different environment.
   - It cannot check secrets: set `DATA_API_KEY` with `wrangler secret put` before deploying.
7. **No CI configuration file.** Spec §13 leaves the CI system open. The README documents the pipeline steps in order.
8. **Left out of the mock**, so nothing shows a total or data the API cannot supply:
   - the account tab counts and type filter;
   - the AMM tag on trades;
   - trust-line limits;
   - the home page's DEX trade count (dropped by the spec);
   - home has no link-preview image.

## How it behaves

- **Search:**
  - A ledger index can be grouped as the pages show it (`107,695,660` or `107 695 660`).
  - A CTID of the other network gets a page offering to open it there.
  - A hash the index lacks is asked of the node.
  - A missing hash, or a missing ledger given by hash, offers "Search on {other network}".
- **Caching:**
  - Immutable pages (ledger, transaction) never stream, and an immutable page is never stored with a missing part. For example, a failed Binary tab makes the page `short`, and a missing previous/next makes it a 503.
  - Answers with a failed section ("Live state unavailable", "Couldn't load transactions") are never stored.
  - A malformed upstream 200 is rejected before the subrequest cache stores it.
  - HEAD is answered from the stored GET copy.
  - A query string on an image URL redirects to the bare path.
- **Errors:** a data API 400 for a well-formed id is a 503 (never a stored 404). The entry's own 503 page and its 30-second Retry-After replace a route's 503 body. A visitor over the rate limit during client-side navigation sees a "Too many requests" screen.
- **Transaction page:**
  - The Binary tab comes from the data API's `?binary=true`. A transaction type the API cannot serialise says so permanently.
  - Previous/next come from the ledger's hash list, and positions are 0-based like the ledger table's `#` column.
  - A page served from the node (not indexed yet) has no previous/next or Binary, and says why.
- **Account page:**
  - The tab list streams in after the header. Bots wait for the whole page.
  - Retry refetches through the explorer, never the data API.
  - The QR code and identicon are drawn on the server, and a page with a destination tag encodes the X-address in its QR.
  - The payments CSV is one API page of up to 1000 rows. Search engines are kept off it.
- **SEO:**
  - Canonical and og URLs use the request's own origin.
  - The ledger canonical and its image use the index.
  - A transaction description reads e.g. "Payment of 2.306481 XRP from rBbW6i…W5jh to rDFDjd…fy48 · XRPL ledger 102,186,243".
- **Link-preview images:** `workers-og` loads only in the image route, with the fonts bundled as byte copies of the `geist` package (pinned by a test).
- **Summaries** read the metadata rather than echoing request fields:
  - partial payments only when delivered < Amount;
  - pool hops are found by lsfAMMNode trust lines too;
  - accounts created exclude AMM pools;
  - ClaimReward with tfOptOut reads "opted out";
  - a failed transaction's sentence ends with the plain-language result text.
- **Times:** `formatUtc` takes unix seconds only, and the node client converts the Ripple epoch at its boundary.

## Not verified yet (needs staging or a real stack)

- The e2e suite against a real data-api-new stack or a deployed staging Worker; it has only run against recorded fixtures.
- Whether the deployed Cache API accepts the subrequest cache's `subrequest-cache.invalid` key host. If it does not, the subrequest cache silently does nothing. Listed in the README's staging checklist.
- A deploy with `workers_dev: false` and no routes, and custom-domain routes.
- The Xahau AccountRoot flag bits; the XRPL ones were checked against ripple-binary-codec.
- This machine has Chromium headless shell 1243, not the 1248 that Playwright 1.64.1 wants. The e2e suite warns locally, and fails in CI unless `E2E_ALLOW_OLDER_CHROMIUM=1` is set.

## Suggested, not built

- A short negative cache or circuit breaker for node failures. During a node outage every account page waits about 3 s and is not stored.
- A CI workflow running `pnpm verify` and `pnpm test:e2e`.

## data-api-new (branch `feat/rate-limit-keys`, unmerged and unpushed)

- Task 1 started at Step 2, because the docs commit was made while setting up the worktree.
- The compose check compares `docker compose … config` with the base commit, since the example env may lack unrelated values.
- The key-rotation steps and secrets lists in docs/operations.md, docs/security.md and docs/deployment.md were fixed although they were outside the plan's file list. Following the old rotation steps would have taken both APIs down.
- The final fix wave folded in the operator-facing doc items the reviewer flagged.
- Parked as "can wait": a few test-hardening items (leak-test form, parser edges, md5 storage assertion, two-key and per-route buckets). The code handles each correctly by inspection.
