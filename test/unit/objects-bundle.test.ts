import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { staticClosure, valueImports } from "../support/value-imports";

// The pages of an escrow, a check and a payment channel are drawn in the browser too (a client-side navigation renders them there), and they never fetch: the view builders
// (`app/server/escrow-view.ts`, `check-view.ts`, `payment-channel-view.ts`, which share `ledger-object-view.ts`) put every href, label, time and figure in the page data, and the
// transaction types are described, the node's entries read and the keylets worked out in the Worker (`domain/describe`, `domain/parse`, `server/keylet.ts`, `ripple-address-codec`).
// So the files the browser runs for these pages import none of the Worker's code as a value: nothing of `app/server` (the marker alphabet, an import-free leaf, aside), of the describe
// and parse trees, of the keylet or of `ripple-*`. A type import is erased and costs nothing; a value import is the bug. (The routes import the server for their loaders; React Router
// drops a loader and what only it uses from the browser's build, and `pnpm check:bundle` holds the result to the budget and finds `AffectedNodes`, `TransactionType` and `FinalFields`
// in `build/client`, in `scripts/bundle-budget.ts`; the tags' builders, `meta-escrow.ts`, `meta-check.ts` and `meta-payment-channel.ts`, are `meta-bundle.test.ts`'s.)
//
// Nor do the pages load what they do not draw. The escrow's window bar and the channel's deposit bar are forms of the chart kit that draw no plot, so they load `ring.ts`, the leaf of the
// ring of a changed figure, and not `Plot.tsx` and its cursor; and a sentence's permission chip loads `permission-chip.ts`, the words of a chip, and not `permissions.ts`, the table of the
// twelve narrower rights (which the Delegation tab's rows and the view builders use).

const appDir = new URL("../../app/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, appDir), "utf8");

/** A specifier of what belongs to the Worker alone: app/server, the describe and parse trees, the keylet and the `ripple-*` packages. */
const SERVER_ONLY = [/\/server\//, /\/describe(\/|$)/, /\/parse(\/|$)/, /\/keylet$/, /ripple-/];
const serverOnly = (from: string) => SERVER_ONLY.some((pattern) => pattern.test(from));

/** The three pages and the frame they share (`LedgerObjectFrame.tsx`: breadcrumb, title row, banners, the states strip, and the two cards of Details and History). */
const PAGES = ["ui/pages/EscrowPage.tsx", "ui/pages/CheckPage.tsx", "ui/pages/PaymentChannelPage.tsx"];
const FRAME = "ui/pages/LedgerObjectFrame.tsx";

/**
 * The leaves the pages load: the kit's parts that are theirs (the states strip, the timeline, the check's flow, the MPT amount, the permission chip of a sentence, the window bar and its ring),
 * and the two files of `app/domain` that a link and a chip are made from, `object-href.ts` (the one decision every inbound link makes) and `permission-chip.ts`.
 */
const LEAVES = [
  "ui/components/StatesStrip.tsx",
  "ui/components/Timeline.tsx",
  "ui/components/CheckFlow.tsx",
  "ui/components/MptAmount.tsx",
  "ui/components/PermissionChip.tsx",
  "ui/charts/WindowBar.tsx",
  "ui/charts/ring.ts",
  "domain/object-href.ts",
  "domain/permission-chip.ts",
];

const FILES = [...PAGES, FRAME, ...LEAVES];

/** What a file the browser loads may reach of the Worker's own files: the marker alphabet (`server/marker.ts`, an import-free leaf, which `parseTrail` reads markers with). */
const ALLOWED = ["server/marker.ts"];

/** The files of a closure that are the Worker's code: app/server (the allowed leaves aside), the describe and parse trees, and `domain/object-status.ts`, which only the view builders read. */
const workerFiles = (closure: string[], allowed: string[] = ALLOWED) =>
  closure.filter((path) => (/^server\//.test(path) && !allowed.includes(path)) || /^domain\/(describe|parse)\//.test(path) || path === "domain/object-status.ts");

describe("the files of the ledger object pages that run in the browser", () => {
  it.each(FILES)("%s imports nothing of the server, describe, parse, the keylet or ripple-* as a value", (file) => {
    expect(valueImports(read(file)).filter(serverOnly)).toEqual([]);
  });

  it.each(FILES)("%s loads none of those through the files it imports either: of app/server it reaches only the marker alphabet, a leaf", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).toContain(file);
    expect(workerFiles(closure)).toEqual([]);
    // No file it reaches loads a ripple-* package either.
    expect(closure.flatMap((path) => valueImports(read(path))).filter((from) => /ripple-/.test(from))).toEqual([]);
    expect(valueImports(read("server/marker.ts"))).toEqual([]);
  });

  it.each(PAGES)("%s draws through the frame, the shared leaves and the kit's table, and links with the one decision of object-href.ts", (file) => {
    const closure = staticClosure(appDir, file);
    expect(closure).toEqual(
      expect.arrayContaining([
        FRAME,
        "ui/components/StatesStrip.tsx",
        "ui/components/Timeline.tsx",
        "ui/components/MptAmount.tsx",
        "ui/components/Sentence.tsx",
        "ui/components/CoverageNote.tsx",
        "domain/object-href.ts",
        "domain/permission-chip.ts",
      ]),
    );
  });

  it("has each page draw its own figure and no other: the escrow's window bar, the check's flow, the channel's deposit bar", () => {
    const [escrow, check, channel] = PAGES.map((file) => staticClosure(appDir, file));
    expect(escrow).toEqual(expect.arrayContaining(["ui/charts/WindowBar.tsx", "ui/charts/ring.ts"]));
    expect(escrow).not.toContain("ui/components/CheckFlow.tsx");
    expect(escrow).not.toContain("ui/charts/ShareBar.tsx");

    expect(check).toContain("ui/components/CheckFlow.tsx");
    expect(check).not.toContain("ui/charts/WindowBar.tsx");
    expect(check).not.toContain("ui/charts/ShareBar.tsx");

    expect(channel).toEqual(expect.arrayContaining(["ui/charts/ShareBar.tsx", "ui/charts/ring.ts"]));
    expect(channel).not.toContain("ui/charts/WindowBar.tsx");
    expect(channel).not.toContain("ui/components/CheckFlow.tsx");
  });

  it.each([...PAGES, FRAME])("%s loads no plot, no chart of the dashboards and no table of narrower rights", (file) => {
    const closure = staticClosure(appDir, file);
    // The ring is a leaf of its own (ring.ts): the share bar and the window bar do not load the plot and its cursor.
    expect(closure).not.toContain("ui/charts/Plot.tsx");
    expect(closure.filter((path) => path.startsWith("ui/charts/") && !/\/(WindowBar|ShareBar|Legend|Cursor|ring|cells|geometry|labels)\.tsx?$/.test(path))).toEqual([]);
    // A sentence's chip loads the words of a chip; the table of the twelve narrower rights is the Delegation tab's and the Worker's.
    expect(closure).not.toContain("domain/permissions.ts");
  });

  it("sees the Worker's code where a file does load it: a view builder reaches the describe and parse trees, the object statuses and the shared builder", () => {
    const builder = staticClosure(appDir, "server/escrow-view.ts");
    expect(workerFiles(builder)).toEqual(
      expect.arrayContaining(["server/escrow-view.ts", "server/ledger-object-view.ts", "domain/describe/index.ts", "domain/parse/index.ts", "domain/object-status.ts"]),
    );
  });

  it("is checked by filters that see each of those, and not a file named like one", () => {
    const source = [
      `import { escrowPage } from "../../server/escrow-view";`,
      `import type { EscrowPageData } from "../../server/escrow-view";`,
      `import { describeTx } from "../../domain/describe";`,
      `import { parseTx } from "../domain/parse/index";`,
      `import { escrowKeylet } from "../../server/keylet";`,
      `import { decodeAccountID } from "ripple-address-codec";`,
      `import { formatAmount } from "../../domain/format";`,
      `import { objectHref } from "../../domain/object-href";`,
      `import { type ObjectKind } from "../../domain/object-link";`,
    ].join("\n");
    expect(valueImports(source).filter(serverOnly)).toEqual([
      "../../server/escrow-view",
      "../../domain/describe",
      "../domain/parse/index",
      "../../server/keylet",
      "ripple-address-codec",
    ]);
    expect(["../../domain/object-keylets", "../domain/keylet-words", "../server-like", "../../domain/parser", "../../domain/describes"].filter(serverOnly)).toEqual([]);
  });
});
