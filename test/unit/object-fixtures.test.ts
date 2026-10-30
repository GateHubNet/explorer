import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ObjectAnswer, ObjectApiKind, ObjectHistoryPage, TxObject } from "../../app/server/api-types";
import { checkDelegations, checkLedgerObject, checkObjectAnswer, checkObjectHistory } from "../../app/server/object-shape";
import { HTTP, isHandWritten, isNftGenerated, isObjectGenerated, readLedgers, servedHashes } from "../../scripts/http-fixtures";
import { derivedObjectRows, rowsOfTransaction } from "../../scripts/object-derive";
import {
  channelKeylet,
  checkKeylet,
  delegateKeylet,
  escrowKeylet,
  OBJECT_ROW_LISTS,
  OBJECTS_ACCOUNT,
  objectAnswers,
  objectFixtures,
  objectWorld,
  SYNTHETIC_DELEGATE,
  syntheticId,
} from "../../scripts/object-fixtures";
import { XRPL_ACCOUNT } from "../e2e/fixtures";
import { OBJECT_CASES, resolveObjectCase, type ObjectCase, type ObjectSources } from "../support/object-case-rules";
import { createUpstream, type NetworkName } from "../support/upstream-core";

// The ledger-object pages' fixtures (scripts/object-fixtures.ts, by the port of D5's rules in scripts/object-derive.ts; test/fixtures/PROVENANCE.md, "Ledger object answers"): the
// generator's answers before serialization, checked against the client's shape checks, the reference's key orders and examples (docs/api-reference.md of data-api-new at
// 0c2e58c3995cb3fdc240c3bf89dea9c4ab1e8adb, "Ledger objects"), the recordings, and the cases the pages draw.

type Json = Record<string, any>;
const NETS: NetworkName[] = ["xrpl", "xahau"];
const ROUTES: Record<ObjectApiKind, string> = { escrow: "escrows", check: "checks", payment_channel: "payment_channels" };
const KIND_OF_ROUTE: Record<string, ObjectApiKind> = { escrows: "escrow", checks: "check", payment_channels: "payment_channel" };

const answers = Object.fromEntries(NETS.map((net) => [net, objectAnswers(net)])) as Record<NetworkName, Array<{ path: string; value: unknown }>>;
const files = new Map(NETS.flatMap((net) => objectFixtures(net)));
const worlds = Object.fromEntries(NETS.map((net) => [net, objectWorld(net)])) as Record<NetworkName, ReturnType<typeof objectWorld>>;
const valueAt = (path: string): Json | undefined => NETS.flatMap((net) => answers[net]).find((each) => each.path === path)?.value as Json | undefined;
const objectOf = (answer: Json): Json => answer.escrow ?? answer.check ?? answer.payment_channel;

/** What the case rules read, from the generator's files (test/support/object-cases.ts reads the committed files with the same rules). */
function sourcesOf(net: NetworkName): ObjectSources {
  const sources = { answers: new Map(), histories: new Map(), nodes: new Map(), transactions: new Map() } as {
    answers: Map<string, { kind: ObjectApiKind; answer: ObjectAnswer }>;
    histories: Map<string, Map<string, ObjectHistoryPage>>;
    nodes: Map<string, Json>;
    transactions: Map<string, TxObject>;
  };
  for (const { path, value } of answers[net]) {
    let match: RegExpExecArray | null;
    if ((match = /^[a-z]+\/data-api\/(escrows|checks|payment_channels)\/([0-9A-F]{64})\.json$/.exec(path))) {
      sources.answers.set(match[2]!, { kind: KIND_OF_ROUTE[match[1]!]!, answer: value as ObjectAnswer });
    } else if ((match = /\/([0-9A-F]{64})\/history@descending=true&limit=\d+&marker=([^&]+)\.json$/.exec(path))) {
      const pages = sources.histories.get(match[1]!) ?? new Map();
      pages.set(match[2]!, value as ObjectHistoryPage);
      sources.histories.set(match[1]!, pages);
    } else if ((match = /\/node\/ledger_entry\/([0-9A-F]{64})\.json$/.exec(path))) sources.nodes.set(match[1]!, (value as Json).result.node);
    else if ((match = /\/data-api\/transactions\/([0-9A-F]{64})\.json$/.exec(path))) sources.transactions.set(match[1]!, (value as Json).transaction);
  }
  return sources;
}

/**
 * The reference's examples (docs/api-reference.md at the pin, "Ledger objects"), each answer as its JSON text: two escrows, two checks, two channels, Xahau's delegations of an
 * account, and two lookups. They are real answers over the recordings these fixtures copy, so the port must give them exactly, key order and all.
 */
const EXAMPLES: string[] = [
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":true},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","escrow":{"escrow_id":"B95064B1A92F02EE009E6BDFB369CF476FB925BB8615456970E38774034A5D30","account":"rNeJW71pMjKy42j5jn7vnWZAbmuU6SKs6V","sequence":107896555,"destination":"rGtW2dWHmHQ3f65pfbjYF5PbFbdZwgwuqW","amount":{"currency":"XRP","value":"0.5"},"finish_after":"2026-10-25T16:50:01Z","cancel_after":"2026-10-25T17:49:01Z","source_tag":2610250016,"status":"can_be_cancelled","created":{"ledger_index":107897249,"time":"2026-10-25T16:49:20Z","tx_hash":"BF93E9B72AE372BCEB27781CA58C4ABE7E51EE9F5D254D02B83C92EC1A22AE53"}},"history":[{"event":"create","ledger_index":107897249,"time":"2026-10-25T16:49:20Z","tx_hash":"BF93E9B72AE372BCEB27781CA58C4ABE7E51EE9F5D254D02B83C92EC1A22AE53","tx_type":"EscrowCreate","account":"rNeJW71pMjKy42j5jn7vnWZAbmuU6SKs6V","result":"tesSUCCESS","amount":{"currency":"XRP","value":"0.5"}}]}',
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":true},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","escrow":{"escrow_id":"FA8631A0C654F964699C8B9A1277DA0C3F62D034190E62062F2D662A9D23C1B4","account":"rfd4xkXuigdGJV2XYkbosFzBQaLsc6M8Vm","sequence":107945427,"destination":"rHiwfnKJCwNePaTj8HmEYCx8G5NCsSEJSt","amount":{"currency":"XRB","issuer":"rD9ixf7RRUKuKVFTsZa3fZGAN6HtNziPKa","value":"75000"},"finish_after":"2026-10-28T22:14:47Z","status":"finished","created":{"ledger_index":107945438,"time":"2026-10-27T22:14:51Z","tx_hash":"3D7F58900F76F6B50D7B5BB1988D9E3C4E33744928B14DE1106848FFA9A3343C"},"removed":{"ledger_index":107967068,"time":"2026-10-28T22:14:51Z","tx_hash":"375202E930018352EA63F82A1DCAF7795916DC5117C74D013119E67955C157DA","tx_type":"EscrowFinish"}},"history":[{"event":"finish","ledger_index":107967068,"time":"2026-10-28T22:14:51Z","tx_hash":"375202E930018352EA63F82A1DCAF7795916DC5117C74D013119E67955C157DA","tx_type":"EscrowFinish","account":"rPw6JAdM9BGwH4y4LxJQBDybaGNhFLCspU","result":"tesSUCCESS"},{"event":"create","ledger_index":107945438,"time":"2026-10-27T22:14:51Z","tx_hash":"3D7F58900F76F6B50D7B5BB1988D9E3C4E33744928B14DE1106848FFA9A3343C","tx_type":"EscrowCreate","account":"rfd4xkXuigdGJV2XYkbosFzBQaLsc6M8Vm","result":"tesSUCCESS","amount":{"currency":"XRB","issuer":"rD9ixf7RRUKuKVFTsZa3fZGAN6HtNziPKa","value":"75000"}}]}',
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":true},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","check":{"check_id":"60FCB1E8C72A695CBB6BDF718D30AF2310A9BED6D3F6D92F54C0E429186D1A42","account":"r9CaVb4X1JVQoi6Q8Gw5cznAMRFARJDWyN","sequence":106635339,"destination":"rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ","send_max":{"currency":"524C555344000000000000000000000000000000","issuer":"rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De","value":"1"},"expiration":"2026-10-16T17:49:51Z","invoice_id":"AB9E9A322F4A89059C5402523B218CA53745DE3672A109BD14BB1A186640AD36","source_tag":804681468,"status":"expired","created":{"ledger_index":107698980,"time":"2026-10-16T16:50:02Z","tx_hash":"CCDBCADF2DE0EF5E85A3332C4CADE9A0C28F3B5E7220C4890E27D196415D0326"}},"history":[{"event":"create","ledger_index":107698980,"time":"2026-10-16T16:50:02Z","tx_hash":"CCDBCADF2DE0EF5E85A3332C4CADE9A0C28F3B5E7220C4890E27D196415D0326","tx_type":"CheckCreate","account":"r9CaVb4X1JVQoi6Q8Gw5cznAMRFARJDWyN","result":"tesSUCCESS","send_max":{"currency":"524C555344000000000000000000000000000000","issuer":"rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De","value":"1"},"expiration":"2026-10-16T17:49:51Z"}]}',
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":false},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","check":{"check_id":"AEE1BCC3B4C8EA870EF61879D9BCA66C07F6E717F8F80F6C93DEB7533C01A822","account":"r3f6bMRipu5zneH4k7ieERt4PGhXCJkVDH","sequence":106641443,"destination":"rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ","send_max":{"currency":"524C555344000000000000000000000000000000","issuer":"rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De","value":"1"},"expiration":"2026-10-16T22:55:21Z","invoice_id":"CAFA37B4E24B58A46C1E5FCADF76C5E6429F4B793473EA582C186DF795E38107","source_tag":804681468,"delivered":{"currency":"524C555344000000000000000000000000000000","issuer":"rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De","value":"0.438027"},"status":"cashed","removed":{"ledger_index":107703707,"time":"2026-10-16T21:57:22Z","tx_hash":"3ABD7BA6DA173F446AFA31C5C2D4EA51FC73A3BDA6E9ED7BBC557A215E33B330","tx_type":"CheckCash"}},"history":[{"event":"cash","ledger_index":107703707,"time":"2026-10-16T21:57:22Z","tx_hash":"3ABD7BA6DA173F446AFA31C5C2D4EA51FC73A3BDA6E9ED7BBC557A215E33B330","tx_type":"CheckCash","account":"rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ","result":"tesSUCCESS","delivered":{"currency":"524C555344000000000000000000000000000000","issuer":"rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De","value":"0.438027"}}]}',
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":true},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","payment_channel":{"channel_id":"E22CCE8FA636C8BDF1C3C4AA17FD604B8FDE268E4F6BF9022B5336536F5B69EA","account":"rQQQrUdN1cLdNmxH4dHfKgmX5P4kf3ZrM","sequence":61531741,"destination":"rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR","amount":{"currency":"XRP","value":"1"},"balance":{"currency":"XRP","value":"0.032185"},"remaining":{"currency":"XRP","value":"0.967815"},"settle_delay":1209600,"public_key":"03D63CA73239D94AAF52574A20E3BC26CBDB811CA55A5914FAA28836F079CE0DC3","status":"open","opened_with":{"currency":"XRP","value":"1"},"funds":0,"claims":1,"created":{"ledger_index":107624182,"time":"2026-10-13T08:05:31Z","tx_hash":"E8A8466AF9E1E5E6339F1EAC64A9B8AD7AB4BE42613605511EDC80E1FCD34127"}},"history":[{"event":"claim","ledger_index":107641123,"time":"2026-10-14T02:25:30Z","tx_hash":"886A9054CD78D4C2F1250999F8D65DB3048F8FC9AFB24523AD755B29797AC790","tx_type":"PaymentChannelClaim","account":"rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR","result":"tesSUCCESS","amount":{"currency":"XRP","value":"1"},"balance":{"currency":"XRP","value":"0.032185"},"balance_change":{"currency":"XRP","value":"0.032185"}},{"event":"create","ledger_index":107624182,"time":"2026-10-13T08:05:31Z","tx_hash":"E8A8466AF9E1E5E6339F1EAC64A9B8AD7AB4BE42613605511EDC80E1FCD34127","tx_type":"PaymentChannelCreate","account":"rQQQrUdN1cLdNmxH4dHfKgmX5P4kf3ZrM","result":"tesSUCCESS","amount":{"currency":"XRP","value":"1"},"balance":{"currency":"XRP","value":"0"},"settle_delay":1209600}]}',
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":false},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","payment_channel":{"channel_id":"494E75E70AAFD8E655C4EBEA9541991367C038EC2251BEB4ABEBAC2AED8B0B7F","account":"rfn1iu8peiUtayZMqXcpL8rt7x4cfk1Qfu","destination":"rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR","amount":{"currency":"XRP","value":"5.000002"},"balance":{"currency":"XRP","value":"5"},"remaining":{"currency":"XRP","value":"0.000002"},"settle_delay":1209600,"public_key":"03A6C6BED4F26E1EBD97A7A4AE82560D3BA21C465F95A350FEAFC1BF17574CD306","expiration":"2026-10-09T06:04:58Z","status":"closing","funds":1,"claims":0},"history":[{"event":"fund","ledger_index":107220098,"time":"2026-09-25T06:03:01Z","tx_hash":"0E08BB2ADB8831F0D20DC26CB9AEE0782E82C141725ECB7F465B78CF3D63F6DE","tx_type":"PaymentChannelFund","account":"rfn1iu8peiUtayZMqXcpL8rt7x4cfk1Qfu","result":"tesSUCCESS","amount":{"currency":"XRP","value":"5.000002"},"balance":{"currency":"XRP","value":"5"},"amount_change":{"currency":"XRP","value":"0.000001"},"expiration":"2026-10-09T06:04:58Z"},{"event":"renew","ledger_index":107218583,"time":"2026-09-25T04:25:22Z","tx_hash":"FCBC932640226E26E212E3E2F8F71763440DC092A398CA8C84B06FA870CABCE8","tx_type":"PaymentChannelClaim","account":"rfn1iu8peiUtayZMqXcpL8rt7x4cfk1Qfu","result":"tesSUCCESS","amount":{"currency":"XRP","value":"5"},"balance":{"currency":"XRP","value":"0.002469"}},{"event":"close_request","ledger_index":107107437,"time":"2026-09-20T05:20:31Z","tx_hash":"29DE719FF22F8F1CE291BE2350C459CE9B06982EE4B15ACEAA1E5925FFE709DB","tx_type":"PaymentChannelClaim","account":"rfn1iu8peiUtayZMqXcpL8rt7x4cfk1Qfu","result":"tesSUCCESS","amount":{"currency":"XRP","value":"5"},"balance":{"currency":"XRP","value":"0.002469"},"expiration":"2026-10-04T05:20:30Z"}]}',
  '{"result":"success","coverage":{"from_ledger_index":8852809,"complete":true},"ledger_index":26399329,"close_time":"2026-10-09T12:49:32Z","count":0,"delegations":[]}',
  '{"result":"success","ledger_object":{"object_id":"E63226B764F4D7C198DBF8E4DE0F5DA4F9C1AC449C2927F2150C0B731E020851","object_type":"Delegate","account":"rnt8PbBFT7idcLyj9PNgxjZi9Z1RiRX3QL","deleted":false,"ledger_index":107558036}}',
  '{"result":"success","ledger_object":{"object_id":"FA8631A0C654F964699C8B9A1277DA0C3F62D034190E62062F2D662A9D23C1B4","object_type":"Escrow","account":"rfd4xkXuigdGJV2XYkbosFzBQaLsc6M8Vm","deleted":true,"ledger_index":107967068}}',];

/** The reference's key lines ("Keys of …, in order"), copied from the pin: a key marked `?` can be missing. */
const KEY_LINES: Record<string, string> = {
  coverage: "from_ledger_index?, complete",
  amount: "currency, issuer?, value, mpt_issuance_id?",
  event: "event, ledger_index, time, tx_hash, tx_type, account, delegate?, result",
  escrowEvent: "amount?, fulfillment?",
  checkEvent: "send_max?, expiration?, delivered?",
  channelEvent: "amount, balance, amount_change?, balance_change?, expiration?, settle_delay?",
  created: "ledger_index, time, tx_hash",
  removed: "ledger_index, time, tx_hash, tx_type",
  permission: "permission, kind, transaction_type?",
  delegation: "delegation_id, account, authorize, permissions, updated, created?",
  ledgerObject: "object_id, object_type, account, deleted, ledger_index",
  escrow:
    "escrow_id, account, sequence?, destination, amount, finish_after?, cancel_after?, condition?, fulfillment?, destination_tag?, source_tag?, transfer_rate?, status, created?, removed?",
  check: "check_id, account, sequence?, destination, send_max, expiration?, invoice_id?, destination_tag?, source_tag?, delivered?, status, created?, removed?",
  payment_channel:
    "channel_id, account, sequence?, destination, amount, balance, remaining, settle_delay, public_key, expiration?, cancel_after?, destination_tag?, source_tag?, status, opened_with?, funds, claims, created?, removed?",
  escrowAnswer: "result, coverage, ledger_index, close_time, escrow, history, history_marker?",
  checkAnswer: "result, coverage, ledger_index, close_time, check, history, history_marker?",
  payment_channelAnswer: "result, coverage, ledger_index, close_time, payment_channel, history, history_marker?",
  historyAnswer: "result, coverage, ledger_index, close_time, count, marker?, history",
  delegationsAnswer: "result, coverage, ledger_index, close_time, count, marker?, delegations",
  ledgerObjectAnswer: "result, ledger_object",
};

/** Throws unless `value`'s keys are the line's, in its order, every key without `?` there. */
function expectKeys(value: Json, line: string, where: string): void {
  const keys = line.split(", ");
  const names = keys.map((key) => key.replace(/\?$/, ""));
  const present = Object.keys(value);
  expect(present, where).toEqual(names.filter((name) => present.includes(name)));
  for (const key of keys) if (!key.endsWith("?")) expect(present, `${where}: ${key}`).toContain(key);
}

const AMOUNT_KEYS = ["amount", "send_max", "delivered", "balance", "remaining", "opened_with", "amount_change", "balance_change"];

function expectObjectKeys(kind: ObjectApiKind, answer: Json, where: string): void {
  expectKeys(answer.coverage, KEY_LINES.coverage!, `${where} coverage`);
  const object = answer[kind];
  if (object !== undefined) {
    expectKeys(object, KEY_LINES[kind]!, where);
    for (const key of AMOUNT_KEYS) if (object[key] !== undefined) expectKeys(object[key], KEY_LINES.amount!, `${where} ${key}`);
    if (object.created !== undefined) expectKeys(object.created, KEY_LINES.created!, `${where} created`);
    if (object.removed !== undefined) expectKeys(object.removed, KEY_LINES.removed!, `${where} removed`);
  }
  const extras = KEY_LINES[`${kind === "payment_channel" ? "channel" : kind}Event`]!;
  for (const [at, event] of (answer.history as Json[]).entries()) {
    expectKeys(event, `${KEY_LINES.event}, ${extras}`, `${where} history[${at}]`);
    for (const key of AMOUNT_KEYS) if (event[key] !== undefined) expectKeys(event[key], KEY_LINES.amount!, `${where} history[${at}].${key}`);
  }
}

const handWritten = (net: NetworkName, path: string): Json => JSON.parse(readFileSync(new URL(`${net}/${path}`, HTTP), "utf8"));
const DELEGATIONS = (account: string, direction: "given" | "held") => `data-api/accounts/${account}/delegations@direction=${direction}&limit=200.json`;

describe.each(NETS)("%s", (net) => {
  it("every object answer, history page and lookup passes its shape check", () => {
    let counted = 0;
    for (const { path, value } of answers[net]) {
      let match: RegExpExecArray | null;
      if ((match = /\/data-api\/(escrows|checks|payment_channels)\/([0-9A-F]{64})\.json$/.exec(path))) {
        expect(() => checkObjectAnswer(KIND_OF_ROUTE[match![1]!]!, value, `/v2/${match![1]}/${match![2]}`), path).not.toThrow();
        counted++;
      } else if ((match = /\/data-api\/(escrows|checks|payment_channels)\/([0-9A-F]{64})\/history@(.+)\.json$/.exec(path))) {
        expect(() => checkObjectHistory(KIND_OF_ROUTE[match![1]!]!, value, `/v2/${match![1]}/${match![2]}/history?${match![3]}`), path).not.toThrow();
      } else if ((match = /\/data-api\/ledger_objects\/([0-9A-F]{64})\.json$/.exec(path))) {
        expect((value as Json).result, path).toBe("success");
        expect(() => checkLedgerObject((value as Json).ledger_object, `/v2/ledger_objects/${match![1]}`), path).not.toThrow();
      }
    }
    expect(counted).toBeGreaterThan(net === "xrpl" ? 200 : 6);
    // The hand-written delegations files, which the Delegation tab reads.
    if (net === "xrpl") {
      for (const account of [XRPL_ACCOUNT, "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC", "rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC"]) {
        for (const direction of ["given", "held"] as const) {
          const page = handWritten(net, DELEGATIONS(account, direction));
          expect(() => checkDelegations(page, `/v2/accounts/${account}/delegations?direction=${direction}&limit=200`)).not.toThrow();
        }
      }
    }
  });

  it("every escrow's ID is the LedgerIndex of the node its EscrowCreate created, and the keylet of its owner and sequence", () => {
    const world = worlds[net];
    let created = 0;
    for (const { path, value } of answers[net]) {
      if (!/\/data-api\/escrows\/[0-9A-F]{64}\.json$/.test(path)) continue;
      const escrow = (value as Json).escrow;
      if (escrow.sequence !== undefined) expect(escrowKeylet(escrow.account, escrow.sequence), path).toBe(escrow.escrow_id);
      if (escrow.created === undefined) continue;
      const placed = world.txs.get(escrow.created.tx_hash)!;
      expect(placed.tx.TransactionType, path).toBe("EscrowCreate");
      const nodes = (placed.tx.metaData.AffectedNodes as Json[]).map((wrapper) => wrapper.CreatedNode).filter((node) => node?.LedgerEntryType === "Escrow");
      expect(nodes.map((node) => node.LedgerIndex), path).toEqual([escrow.escrow_id]);
      created++;
    }
    expect(created).toBeGreaterThan(net === "xrpl" ? 8 : 1);
  });

  it("writes every object, event and body in the reference's key order", () => {
    for (const { path, value } of answers[net]) {
      const body = value as Json;
      let match: RegExpExecArray | null;
      if ((match = /\/data-api\/(escrows|checks|payment_channels)\/[0-9A-F]{64}\.json$/.exec(path))) {
        const kind = KIND_OF_ROUTE[match[1]!]!;
        expectKeys(body, KEY_LINES[`${kind}Answer`]!, path);
        expectObjectKeys(kind, body, path);
      } else if ((match = /\/data-api\/(escrows|checks|payment_channels)\/[0-9A-F]{64}\/history@/.exec(path))) {
        expectKeys(body, KEY_LINES.historyAnswer!, path);
        expectObjectKeys(KIND_OF_ROUTE[match[1]!]!, body, path);
      } else if (/\/data-api\/ledger_objects\//.test(path)) {
        expectKeys(body, KEY_LINES.ledgerObjectAnswer!, path);
        expectKeys(body.ledger_object, KEY_LINES.ledgerObject!, path);
      }
    }
  });

  it("writes the same output for the same input, each list a row to a line", () => {
    const again = objectFixtures(net);
    const mine = [...files].filter(([path]) => path.startsWith(`${net}/`));
    expect(again.map(([path]) => path)).toEqual(mine.map(([path]) => path));
    for (const [path, text] of again) expect(files.get(path), path).toBe(text);
    expect(objectAnswers(net)).toEqual(answers[net]);
    // A row of an object's history is one line.
    const long = [...files].find(([path]) => path.includes("/payment_channels/") && path.includes("/history@"));
    if (net === "xrpl") expect(long![1].split("\n").filter((line) => line.trimStart().startsWith('{"account"'))).toHaveLength(50);
    expect(OBJECT_ROW_LISTS).toEqual(["history", "delegations"]);
  });

  it("is what isObjectGenerated names, none of it written by hand and none of it the NFT generator's, and nothing on disk that it names is missing", () => {
    for (const path of files.keys()) {
      if (!path.startsWith(`${net}/`)) continue;
      expect(isObjectGenerated(path), path).toBe(true);
      expect(isHandWritten(path), path).toBe(false);
      expect(isNftGenerated(path), path).toBe(false);
    }
    const onDisk = readdirSync(HTTP, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `${entry.parentPath.slice(HTTP.pathname.length)}/${entry.name}`.replace(/^\//, ""))
      .filter((path) => path.startsWith(`${net}/`) && isObjectGenerated(path));
    expect(onDisk.sort()).toEqual([...files.keys()].filter((path) => path.startsWith(`${net}/`)).sort());
    // The sets' own transactions and ledgers, and the NFT generator's URIToken entries, are not its.
    expect(isObjectGenerated(`xrpl/data-api/transactions/${[...servedHashes("xrpl")][0]}.json`)).toBe(false);
    expect(isObjectGenerated("xrpl/data-api/ledgers/107721455@transactions=true.json")).toBe(false);
    expect(isObjectGenerated("xahau/node/ledger_entry/35B8D52858E0463C0F0FCCC73EFBE1D308F0AF71112035C4D45777EB9115E93D.json")).toBe(false);
    expect(isNftGenerated("xahau/node/ledger_entry/35B8D52858E0463C0F0FCCC73EFBE1D308F0AF71112035C4D45777EB9115E93D.json")).toBe(true);
  });

  it("serves the transactions behind the objects: a tracked node, a Delegate or a DelegateSet, but the sets' own and the bulk cancels, each in a ledger whose list holds it at its place", () => {
    const world = worlds[net];
    const already = servedHashes(net);
    const inSets = new Set(readLedgers(net).map((raw) => Number(raw.ledger.ledger_index)));
    let skipped = 0;
    for (const raw of world.ledgers) {
      for (const tx of raw.ledger.transactions) {
        const wanted = rowsOfTransaction(raw, tx).length > 0 || typeof tx.Delegate === "string" || tx.TransactionType === "DelegateSet";
        const path = `${net}/data-api/transactions/${tx.hash}.json`;
        if (!wanted || already.has(tx.hash)) {
          expect(files.has(path), path).toBe(false);
          continue;
        }
        if (!files.has(path)) {
          expect(tx.TransactionType, path).toBe("EscrowCancel");
          skipped++;
          continue;
        }
        expect(files.has(`${net}/data-api/transactions/${tx.hash}@binary=true.json`), path).toBe(true);
        const index = Number(raw.ledger.ledger_index);
        const list = inSets.has(index) ? undefined : (valueAt(`${net}/data-api/ledgers/${index}@transactions=true.json`) as Json);
        if (!inSets.has(index)) expect(list!.ledger.transactions[tx.metaData.TransactionIndex], path).toBe(tx.hash);
      }
    }
    // The 190 escrow cancels of the token testers in ledger 106179366 (not the manifest's case): their escrows are derived, their transactions have no file (C4's budget).
    expect(skipped).toBe(net === "xrpl" ? 190 : 0);
  });
});

describe("the recordings' objects", () => {
  it("derive the reference's examples exactly: the escrows, checks and channels, Xahau's delegations of an account, and the lookups", async () => {
    for (const text of EXAMPLES) {
      const example = JSON.parse(text) as Json;
      if (example.ledger_object !== undefined) {
        expect(JSON.stringify(valueAt(`xrpl/data-api/ledger_objects/${example.ledger_object.object_id}.json`))).toBe(text);
      } else if (example.delegations !== undefined) {
        // The mock answers an account with no file as D5 answers it (C11).
        const upstream = createUpstream({
          files: { read: async () => undefined },
          bases: { xrpl: { dataApi: "http://f.test/xrpl", node: "http://f.test/xrpl-node" }, xahau: { dataApi: "http://f.test/xahau", node: "http://f.test/xahau-node" } },
          primary: "xahau",
        });
        const answer = await upstream.handle(new Request("http://f.test/xahau/v2/accounts/rKqZCLrHu8dMPj444xPrDQCXUpZr6U2VWi/delegations", { headers: { "X-API-Key": "k" } }));
        expect(await answer!.text()).toBe(text);
      } else {
        const [kind] = (["escrow", "check", "payment_channel"] as const).filter((each) => example[each] !== undefined);
        const id = example[kind!][kind === "payment_channel" ? "channel_id" : `${kind}_id`];
        expect(JSON.stringify(valueAt(`xrpl/data-api/${ROUTES[kind!]}/${id}.json`)), id).toBe(text);
      }
    }
  });

  it("derives finished, cancelled, cashed, closed and open statuses where the recordings show them", () => {
    const statuses = (net: NetworkName): Record<string, string[]> => {
      const recorded = new Set(derivedObjectRows(worlds[net].ledgers).map((row) => row.object_id));
      const found: Record<string, string[]> = {};
      for (const { path, value } of answers[net]) {
        const match = /\/data-api\/(escrows|checks|payment_channels)\/([0-9A-F]{64})\.json$/.exec(path);
        if (match === null || !recorded.has(match[2]!)) continue;
        (found[match[1]!] ??= []).push(objectOf(value as Json).status);
      }
      return Object.fromEntries(Object.entries(found).map(([route, list]) => [route, [...new Set(list)].sort()]));
    };
    expect(statuses("xrpl")).toEqual({
      checks: ["cancelled", "cashed", "expired", "open"],
      escrows: ["can_be_cancelled", "cancelled", "finished"],
      payment_channels: ["closed", "closing", "open"],
    });
    expect(statuses("xahau")).toEqual({ checks: ["cashed"], escrows: ["cancelled", "finished", "pending"], payment_channels: ["open"] });
    // The escrow D5's reference names as the one created before the index and finished after it: no `created`, coverage not whole (C8).
    const incomplete = valueAt("xrpl/data-api/escrows/8993DA09444641A6BDA272A292157A0E8AF79F040AA4E551C48257F493228455.json")!;
    expect(incomplete.coverage).toEqual({ from_ledger_index: 102145584, complete: false });
    expect(incomplete.escrow.status).toBe("finished");
    expect(incomplete.escrow).not.toHaveProperty("created");
  });

  it("gives an object complete coverage exactly when its creation is indexed (C8)", () => {
    for (const net of NETS) {
      for (const { path, value } of answers[net]) {
        if (!/\/data-api\/(escrows|checks|payment_channels)\/[0-9A-F]{64}\.json$/.test(path)) continue;
        const body = value as Json;
        expect(body.coverage, path).toEqual({ from_ledger_index: worlds[net].coverage.from_ledger_index, complete: objectOf(body).created !== undefined });
      }
    }
  });
});

describe("the synthetic objects", () => {
  it("chains channel-long's three pages to 120 events, newest first, by their markers", () => {
    const id = syntheticId("xrpl", "channel-long");
    const answer = valueAt(`xrpl/data-api/payment_channels/${id}.json`)!;
    const pages: Json[] = [];
    for (let marker = answer.history_marker; marker !== undefined; ) {
      const page = valueAt(`xrpl/data-api/payment_channels/${id}/history@descending=true&limit=50&marker=${marker}.json`)!;
      expect(page.count).toBe(page.history.length);
      pages.push(page);
      marker = page.marker;
    }
    expect([answer.history.length, ...pages.map((page) => page.history.length)]).toEqual([50, 50, 20]);
    const events = [...answer.history, ...pages.flatMap((page) => page.history)] as Json[];
    expect(events).toHaveLength(120);
    // Newest first, one place each: page 1 is events 120 to 71 (counted from the creation, the first), the marker of a page the place of its last event.
    const places = events.map((event) => [event.ledger_index, event.tx_hash] as const);
    expect(new Set(places.map(([, hash]) => hash)).size).toBe(120);
    for (let at = 1; at < events.length; at++) expect(events[at - 1]!.ledger_index).toBeGreaterThanOrEqual(events[at]!.ledger_index);
    expect(events.at(-1)!.event).toBe("create");
    expect(events.filter((event) => event.event === "fund")).toHaveLength(11);
    expect(answer.payment_channel).toMatchObject({ status: "open", funds: 11, claims: 108 });
    const decode = (marker: string) => JSON.parse(Buffer.from(marker, "base64url").toString("utf8")) as [number, number];
    expect(decode(answer.history_marker)[0]).toBe(answer.history[49].ledger_index);
    expect(decode(pages[0]!.marker)[0]).toBe(pages[0]!.history[49].ledger_index);
    expect(pages[1]).not.toHaveProperty("marker");
    // The pages are of the same channel and coverage as the answer.
    for (const page of pages) expect(page.coverage).toEqual(answer.coverage);
  });

  it("are the states the recordings cannot give, with their own keylets, the account's live ones made before the explorer's newest ledger", () => {
    const status = (name: string, route: string) => objectOf(valueAt(`xrpl/data-api/${route}/${syntheticId("xrpl", name)}.json`)!);
    expect(status("escrow-cancellable", "escrows")).toMatchObject({ account: OBJECTS_ACCOUNT, status: "can_be_cancelled" });
    expect(status("escrow-cancelled", "escrows")).toMatchObject({ account: OBJECTS_ACCOUNT, status: "cancelled", removed: { tx_type: "EscrowCancel" } });
    expect(status("escrow-pending", "escrows").status).toBe("pending");
    expect(status("escrow-finishable", "escrows").status).toBe("can_be_finished");
    expect(status("escrow-mpt", "escrows").amount).toMatchObject({ mpt_issuance_id: "0000012AB5F762798A53D543A014CAF8B297CFF8F2F937E8", value: "250" });
    expect(status("check-expired", "checks")).toMatchObject({ destination: OBJECTS_ACCOUNT, status: "expired" });
    expect(status("channel-closing", "payment_channels")).toMatchObject({ account: OBJECTS_ACCOUNT, status: "closing", claims: 1, funds: 0 });
    for (const name of ["escrow-cancellable", "check-expired", "channel-closing"]) {
      const node = valueAt(`xrpl/node/ledger_entry/${syntheticId("xrpl", name)}.json`)!.result.node;
      expect(node.PreviousTxnLgrSeq, name).toBeLessThanOrEqual(107721455);
      const id = node.LedgerEntryType === "Escrow" ? escrowKeylet(node.Account, node.Sequence) : node.LedgerEntryType === "Check" ? checkKeylet(node.Account, node.Sequence) : channelKeylet(node.Account, node.Destination, node.Sequence);
      expect(id, name).toBe(node.index);
    }
    expect(OBJECTS_ACCOUNT).toBe(XRPL_ACCOUNT);
  });

  it("make the delegation cases of C9 from recorded transactions, in the ledger of the recorded DelegateSet, past its own transactions", () => {
    const world = worlds.xrpl;
    expect(world.delegation.map((made) => made.name)).toEqual(["delegated-payment", "delegated-tec", "delegate-set-empty", "delegate-set-failed"]);
    const set = world.ledgers.flatMap((raw) => raw.ledger.transactions).find((tx) => tx.TransactionType === "DelegateSet")!;
    for (const made of world.delegation) {
      const served = valueAt(`xrpl/data-api/transactions/${made.tx.hash}.json`)!.transaction as TxObject;
      expect(served.ledger_index, made.name).toBe(107558036);
      expect(served.meta.TransactionIndex, made.name).toBeGreaterThanOrEqual(made.raw.ledger.transactions.length);
      expect(valueAt(`xrpl/data-api/ledgers/107558036@transactions=true.json`)!.ledger.transactions[served.meta.TransactionIndex]).toBe(made.tx.hash);
      expect(rowsOfTransaction(made.raw, made.tx).length > 0, made.name).toBe(made.name === "delegate-set-empty");
    }
    const [payment, tec, empty, failed] = world.delegation.map((made) => made.tx);
    for (const tx of [payment!, tec!]) {
      expect(tx.TransactionType).toBe("Payment");
      expect(tx.Delegate).toBe(SYNTHETIC_DELEGATE);
      const delegateRoot = (tx.metaData.AffectedNodes as Json[]).map((wrapper) => wrapper.ModifiedNode).find((node) => node?.FinalFields?.Account === SYNTHETIC_DELEGATE);
      expect(BigInt(delegateRoot.PreviousFields.Balance) - BigInt(delegateRoot.FinalFields.Balance)).toBe(BigInt(tx.Fee!));
    }
    expect(payment!.metaData.TransactionResult).toBe("tesSUCCESS");
    expect(tec!.metaData.TransactionResult).toMatch(/^tec/);
    expect(empty!.Permissions).toEqual([]);
    expect(rowsOfTransaction(world.delegation[2]!.raw, empty!)).toMatchObject([{ object_type: "Delegate", action: "deleted", event: "delete", owner: set.Account }]);
    expect(failed!.metaData.TransactionResult).toBe("tecINSUFFICIENT_RESERVE");
    expect((failed!.metaData.AffectedNodes as Json[]).map((wrapper) => wrapper.ModifiedNode?.LedgerEntryType)).toEqual(["AccountRoot"]);
    // Not rows of the index: the recorded delegation is as D5 says, not deleted.
    expect(valueAt(`xrpl/data-api/ledger_objects/${delegateKeylet(set.Account as string, set.Authorize as string)}.json`)!.ledger_object.deleted).toBe(false);
  });
});

describe("the cases and the account's files", () => {
  const EXPECTED: Partial<Record<ObjectCase, (net: NetworkName) => string | undefined>> = {
    "escrow-cancellable": () => syntheticId("xrpl", "escrow-cancellable"),
    "escrow-cancelled": () => syntheticId("xrpl", "escrow-cancelled"),
    "escrow-pending": () => syntheticId("xrpl", "escrow-pending"),
    "escrow-finishable": () => syntheticId("xrpl", "escrow-finishable"),
    "escrow-mpt": () => syntheticId("xrpl", "escrow-mpt"),
    "escrow-finished": () => "FA8631A0C654F964699C8B9A1277DA0C3F62D034190E62062F2D662A9D23C1B4",
    "escrow-incomplete": () => "8993DA09444641A6BDA272A292157A0E8AF79F040AA4E551C48257F493228455",
    "check-expired": () => syntheticId("xrpl", "check-expired"),
    "channel-closing": () => syntheticId("xrpl", "channel-closing"),
    "channel-long": () => syntheticId("xrpl", "channel-long"),
    "channel-open": () => "E22CCE8FA636C8BDF1C3C4AA17FD604B8FDE268E4F6BF9022B5336536F5B69EA",
  };

  it.each(OBJECT_CASES.filter((which) => !which.startsWith("xahau-")))("XRPL holds %s", (which) => {
    const found = resolveObjectCase(which, sourcesOf("xrpl"))!;
    expect(found, which).toBeDefined();
    const expected = EXPECTED[which]?.("xrpl");
    if (expected !== undefined) expect(found.id).toBe(expected);
    if (which.endsWith("-node-only")) {
      expect(files.has(`xrpl/node/ledger_entry/${found.id}.json`)).toBe(true);
      expect([...files.keys()].some((path) => path.includes(found.id) && path.includes("/data-api/"))).toBe(false);
      expect(worlds.xrpl.nodeOnly.has(found.id)).toBe(true);
    }
    if (which === "channel-long") expect(found.markers).toHaveLength(2);
    if (["delegated-payment", "delegated-tec", "delegate-set-empty", "delegate-set-failed"].includes(which)) {
      expect(worlds.xrpl.delegation.find((made) => made.name === which)!.tx.hash).toBe(found.id);
    }
  });

  it.each(["xahau-escrow", "xahau-token-channel"] as const)("Xahau holds %s", (which) => {
    const found = resolveObjectCase(which, sourcesOf("xahau"))!;
    const object = objectOf(sourcesOf("xahau").answers.get(found.id)!.answer as unknown as Json);
    if (which === "xahau-escrow") expect(object.amount.currency).toBe("XAH");
    else expect(object.amount.currency).toBe("DHA");
  });

  it("gives every object of XRPL_ACCOUNT's account_objects an index or a node file: its trust line, the three live synthetic objects and a Delegate it gave (C7)", () => {
    for (const file of [`node/account_objects/${XRPL_ACCOUNT}.json`, `node/account_objects/${XRPL_ACCOUNT}@limit=400.json`]) {
      const objects = handWritten("xrpl", file).result.account_objects as Json[];
      expect(objects.map((object) => object.LedgerEntryType)).toEqual(["RippleState", "Escrow", "Check", "PayChannel", "Delegate"]);
      for (const object of objects.slice(1)) {
        const indexed = [...files.keys()].some((path) => path.startsWith("xrpl/data-api/") && path.endsWith(`/${object.index}.json`));
        expect(indexed || files.has(`xrpl/node/ledger_entry/${object.index}.json`), object.index).toBe(true);
        if (object.LedgerEntryType !== "Delegate") expect(valueAt(`xrpl/node/ledger_entry/${object.index}.json`)!.result.node, object.index).toEqual(object);
      }
      const [, escrow, check, channel, delegate] = objects;
      expect([escrow!.index, check!.index, channel!.index]).toEqual([syntheticId("xrpl", "escrow-cancellable"), syntheticId("xrpl", "check-expired"), syntheticId("xrpl", "channel-closing")]);
      const given = handWritten("xrpl", DELEGATIONS(XRPL_ACCOUNT, "given")).delegations as Json[];
      const delegation = given.find((each) => each.delegation_id === delegate!.index)!;
      expect(delegate).toMatchObject({ Account: XRPL_ACCOUNT, Authorize: delegation.authorize, PreviousTxnID: delegation.updated.tx_hash });
      expect(delegate!.Permissions.map((each: Json) => each.Permission.PermissionValue)).toEqual(delegation.permissions.map((each: Json) => each.permission));
      expect(delegate!.Permissions).toHaveLength(3);
    }
  });

  it("has the board's delegations for XRPL_ACCOUNT, none for the deleted account and an incomplete coverage for the never-funded one, as of the objects' ledger", () => {
    const given = handWritten("xrpl", DELEGATIONS(XRPL_ACCOUNT, "given"));
    const held = handWritten("xrpl", DELEGATIONS(XRPL_ACCOUNT, "held"));
    expect([given.count, held.count]).toEqual([3, 2]);
    for (const each of given.delegations) expect(each.delegation_id).toBe(delegateKeylet(XRPL_ACCOUNT, each.authorize));
    for (const each of held.delegations) expect(each.delegation_id).toBe(delegateKeylet(each.account, XRPL_ACCOUNT));
    expect(given.delegations.map((each: Json) => each.permissions.length)).toEqual([3, 8, 3]);
    expect(held.delegations.map((each: Json) => each.permissions.length)).toEqual([1, 3]);
    // Newest first, by `updated`.
    for (const page of [given, held]) {
      const updated = page.delegations.map((each: Json) => each.updated.ledger_index);
      expect(updated).toEqual([...updated].sort((a: number, b: number) => b - a));
    }
    const world = worlds.xrpl;
    for (const [account, complete, count] of [
      [XRPL_ACCOUNT, true, 3],
      ["r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC", true, 0],
      ["rPzx7uasocDdgSNWoWxFytF8VRsAdLU9SC", false, 0],
    ] as const) {
      const page = handWritten("xrpl", DELEGATIONS(account, "given"));
      expect(page).toMatchObject({ ledger_index: world.asOf.ledger_index, close_time: "2026-10-29T03:50:41Z", count, coverage: { from_ledger_index: world.coverage.from_ledger_index, complete } });
    }
    // Every delegation of the files has its lookup.
    for (const each of [...given.delegations, ...held.delegations]) {
      expect(valueAt(`xrpl/data-api/ledger_objects/${each.delegation_id}.json`)!.ledger_object).toEqual({
        object_id: each.delegation_id,
        object_type: "Delegate",
        account: each.account,
        deleted: false,
        ledger_index: each.updated.ledger_index,
      });
    }
  });

  it("answers the delegations of an account with no file as D5 does, with the objects' ledger and the delegations' coverage (C11)", async () => {
    const upstream = createUpstream({
      files: { read: async () => undefined },
      bases: { xrpl: { dataApi: "http://f.test/xrpl", node: "http://f.test/xrpl-node" }, xahau: { dataApi: "http://f.test/xahau", node: "http://f.test/xahau-node" } },
      primary: "xrpl",
    });
    const answer = await upstream.handle(new Request(`http://f.test/xrpl/v2/accounts/${XRPL_ACCOUNT}/delegations?direction=held&limit=200`, { headers: { "X-API-Key": "k" } }));
    const body = (await answer!.json()) as Json;
    const filed = handWritten("xrpl", DELEGATIONS(XRPL_ACCOUNT, "held"));
    expect(body).toEqual({ ...filed, count: 0, delegations: [] });
    expect(body.ledger_index).toBe(worlds.xrpl.asOf.ledger_index);
  });
});
