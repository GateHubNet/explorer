import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ObjectAnswer, ObjectApiKind, ObjectHistoryPage, TxObject } from "../../app/server/api-types";
import { checkDelegations, checkLedgerObject, checkObjectAnswer, checkObjectHistory } from "../../app/server/object-shape";
import { HTTP, isHandWritten, isNftGenerated, isObjectGenerated, readLedgers, servedHashes, TX_HASH_PREFIX, type RawLedger, type RawTx } from "../../scripts/http-fixtures";
import { derivedAnswer, derivedObjectRows, markerPosition, rowsOfTransaction, type DerivedObjectRow } from "../../scripts/object-derive";
import {
  channelKeylet,
  checkKeylet,
  delegateKeylet,
  escrowKeylet,
  OBJECT_ROW_LISTS,
  OBJECTS_ACCOUNT,
  UNSERVED_SYNTHETIC,
  objectAnswers,
  objectFixtures,
  objectWorld,
  SYNTHETIC_DELEGATE,
  syntheticId,
} from "../../scripts/object-fixtures";
import { XRPL_ACCOUNT, XRPL_ESCROW } from "../e2e/fixtures";
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
 * account, and two lookups. They are real answers over the recordings these fixtures copy, so the port must give them exactly, key order and all. `ASCENDING_EXAMPLES` are the
 * reference's others: an escrow's and a channel's first page of history oldest first (`?limit=1`), which the pages never ask for, and an XRPL account's delegations.
 */
const ASCENDING_EXAMPLES: string[] = [
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":true},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","count":1,"marker":"WzEwNzk0NTQzOCw5OF0","history":[{"event":"create","ledger_index":107945438,"time":"2026-10-27T22:14:51Z","tx_hash":"3D7F58900F76F6B50D7B5BB1988D9E3C4E33744928B14DE1106848FFA9A3343C","tx_type":"EscrowCreate","account":"rfd4xkXuigdGJV2XYkbosFzBQaLsc6M8Vm","result":"tesSUCCESS","amount":{"currency":"XRB","issuer":"rD9ixf7RRUKuKVFTsZa3fZGAN6HtNziPKa","value":"75000"}}]}',
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":true},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","count":1,"marker":"WzEwNzYyNDE4Miw0NF0","history":[{"event":"create","ledger_index":107624182,"time":"2026-10-13T08:05:31Z","tx_hash":"E8A8466AF9E1E5E6339F1EAC64A9B8AD7AB4BE42613605511EDC80E1FCD34127","tx_type":"PaymentChannelCreate","account":"rQQQrUdN1cLdNmxH4dHfKgmX5P4kf3ZrM","result":"tesSUCCESS","amount":{"currency":"XRP","value":"1"},"balance":{"currency":"XRP","value":"0"},"settle_delay":1209600}]}',
];
const DELEGATIONS_EXAMPLE =
  '{"result":"success","coverage":{"from_ledger_index":102145584,"complete":true},"ledger_index":107972102,"close_time":"2026-10-29T03:50:41Z","count":1,"delegations":[{"delegation_id":"E63226B764F4D7C198DBF8E4DE0F5DA4F9C1AC449C2927F2150C0B731E020851","account":"rnt8PbBFT7idcLyj9PNgxjZi9Z1RiRX3QL","authorize":"rw2X2GFePFiLDdcQw6iELFfUEw1hPqAGcK","permissions":[{"permission":"OfferCreate","kind":"transaction"},{"permission":"OfferCancel","kind":"transaction"}],"updated":{"ledger_index":107558036,"time":"2026-10-10T09:03:20Z","tx_hash":"4250B72A5AB63CEB5501CFDDA3B4C9765B85941BB6AECE9720FC6C0D5F524B66"},"created":{"ledger_index":107558036,"time":"2026-10-10T09:03:20Z","tx_hash":"4250B72A5AB63CEB5501CFDDA3B4C9765B85941BB6AECE9720FC6C0D5F524B66"}}]}';
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
    expect(counted).toBeGreaterThan(net === "xrpl" ? 30 : 6);
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

  it("gives every recorded object its keylet: an escrow's and a check's of owner and sequence, a channel's of owner, destination and sequence, a delegation's of its two accounts", () => {
    const keyletOf: Record<string, (row: DerivedObjectRow) => string> = {
      Escrow: (row) => escrowKeylet(row.owner, Number(row.fields.Sequence ?? row.event_fields.sequence)),
      Check: (row) => checkKeylet(row.owner, Number(row.fields.Sequence ?? row.event_fields.sequence)),
      PayChannel: (row) => channelKeylet(row.owner, row.counterparty, Number(row.fields.Sequence ?? row.event_fields.sequence)),
      Delegate: (row) => delegateKeylet(row.owner, row.counterparty),
    };
    const checked: Record<string, number> = {};
    for (const row of derivedObjectRows(worlds[net].ledgers)) {
      if (row.object_type !== "Delegate" && row.fields.Sequence === undefined && row.event_fields.sequence === undefined) continue;
      expect(keyletOf[row.object_type]!(row), `${row.object_type} ${row.object_id}`).toBe(row.object_id);
      checked[row.object_type] = (checked[row.object_type] ?? 0) + 1;
    }
    // Every type the recordings have, with its sequence known (a channel or check of which only a later row is indexed has its `Sequence` in its fields).
    expect(Object.keys(checked).sort()).toEqual(net === "xrpl" ? ["Check", "Delegate", "Escrow", "PayChannel"] : ["Check", "Escrow", "PayChannel"]);
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

  it("serves the transactions behind the objects: a row of the index, a Delegate or a DelegateSet, but the sets' own, each in a ledger whose list holds it at its place", () => {
    const world = worlds[net];
    const already = servedHashes(net);
    const inSets = new Set(readLedgers(net).map((raw) => Number(raw.ledger.ledger_index)));
    const indexed = new Set(world.rows.map((row) => row.tx_hash));
    let skipped = 0;
    for (const raw of world.ledgers) {
      for (const tx of raw.ledger.transactions) {
        const wanted = indexed.has(tx.hash) || typeof tx.Delegate === "string" || tx.TransactionType === "DelegateSet";
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
    expect(skipped).toBe(0);
    // The 190 escrow cancels of the token testers in ledger 106179366 that the manifest does not name are left out of the index: no row, no escrow, no file (the controller's
    // ruling); the case's (the third party's cancel of `E81C0A08…`) stays.
    if (net === "xrpl") {
      const cancels = world.ledgers.flatMap((raw) => raw.ledger.transactions).filter((tx) => tx.TransactionType === "EscrowCancel");
      expect(cancels).toHaveLength(191);
      const kept = cancels.filter((tx) => indexed.has(tx.hash));
      expect(kept.map((tx) => tx.hash)).toEqual(["852853679C20D7128E4201E8F3DC7B7FE894F93A03F7435C9FC7D3980C70C198"]);
      expect(world.rows.filter((row) => row.tx_hash === kept[0]!.hash).map((row) => [row.object_id.slice(0, 10), row.event])).toEqual([["E81C0A083A", "cancel"]]);
      // The escrows answered: the recordings' 11 (the case's cancelled one among them) but the node fallback's, and the five synthetic ones.
      expect([...files.keys()].filter((path) => path.startsWith("xrpl/data-api/escrows/")).length).toBe(15);
    }
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
        expectKeys(example, KEY_LINES.delegationsAnswer!, "Xahau's delegations");
      } else {
        const [kind] = (["escrow", "check", "payment_channel"] as const).filter((each) => example[each] !== undefined);
        const id = example[kind!][kind === "payment_channel" ? "channel_id" : `${kind}_id`];
        expect(JSON.stringify(valueAt(`xrpl/data-api/${ROUTES[kind!]}/${id}.json`)), id).toBe(text);
      }
    }
  });

  it("agrees with the reference's oldest-first pages: the marker is the place of the creation, the event the creation the answer ends with", () => {
    const xrpl = worlds.xrpl;
    for (const text of ASCENDING_EXAMPLES) {
      const example = JSON.parse(text) as Json;
      const [event] = example.history as Json[];
      const created = xrpl.rows.find((row) => row.tx_hash === event!.tx_hash && row.action === "created")!;
      expect(markerPosition(example.marker)).toEqual([created.ledger_index, created.tx_index]);
      const route = created.object_type === "Escrow" ? "escrows" : "payment_channels";
      const answer = valueAt(`xrpl/data-api/${route}/${created.object_id}.json`)!;
      // The same head (the object's coverage, the as-of ledger), and the oldest event of the answer's newest-first history, key order and all.
      expect([answer.result, answer.coverage, answer.ledger_index, answer.close_time]).toEqual([example.result, example.coverage, example.ledger_index, example.close_time]);
      expect(JSON.stringify(answer.history.at(-1))).toBe(JSON.stringify(event));
      expectKeys(example, KEY_LINES.historyAnswer!, route);
    }
  });

  it("gives the reference's delegations of an XRPL account from the delegation's rows, key order and all", () => {
    const example = JSON.parse(DELEGATIONS_EXAMPLE) as Json;
    expectKeys(example, KEY_LINES.delegationsAnswer!, "delegations");
    const [delegation] = example.delegations as Json[];
    expectKeys(delegation!, KEY_LINES.delegation!, "delegation");
    for (const permission of delegation!.permissions as Json[]) expectKeys(permission, KEY_LINES.permission!, "permission");
    // The delegation as D5's `delegationObject` makes it of its rows (one, its creation): its owner and authorize, its node's permissions (transaction types, by name), the places.
    const xrpl = worlds.xrpl;
    const rows = xrpl.rows.filter((row) => row.object_type === "Delegate" && row.object_id === delegation!.delegation_id);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const ref = { ledger_index: row!.ledger_index, time: delegation!.updated.time, tx_hash: row!.tx_hash };
    const derived = {
      delegation_id: row!.object_id,
      account: row!.owner,
      authorize: row!.counterparty,
      permissions: (row!.fields.Permissions as Json[]).map((entry) => ({ permission: entry.Permission.PermissionValue, kind: "transaction" })),
      updated: ref,
      created: ref,
    };
    expect(JSON.stringify(derived)).toBe(JSON.stringify(delegation));
    expect(new Date(row!.close_time * 1000).toISOString().replace(".000", "")).toBe(delegation!.updated.time);
    expect([example.coverage, example.ledger_index]).toEqual([{ from_ledger_index: xrpl.coverage.from_ledger_index, complete: true }, xrpl.asOf.ledger_index]);
    // Its lookup says the same of it.
    expect(valueAt(`xrpl/data-api/ledger_objects/${row!.object_id}.json`)!.ledger_object).toEqual({ object_id: row!.object_id, object_type: "Delegate", account: row!.owner, deleted: false, ledger_index: row!.ledger_index });
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
    const txIndex = new Map(worlds.xrpl.rows.filter((row) => row.object_id === id).map((row) => [row.tx_hash, row.tx_index]));
    const places = events.map((event) => [event.ledger_index, txIndex.get(event.tx_hash)!] as const);
    expect(new Set(events.map((event) => event.tx_hash)).size).toBe(120);
    for (let at = 1; at < places.length; at++) {
      const [[ledger, index], [olderLedger, olderIndex]] = [places[at - 1]!, places[at]!];
      expect(ledger > olderLedger || (ledger === olderLedger && index > olderIndex), `${at}`).toBe(true);
    }
    expect(events.at(-1)!.event).toBe("create");
    expect(events.filter((event) => event.event === "fund")).toHaveLength(11);
    expect(answer.payment_channel).toMatchObject({ status: "open", funds: 11, claims: 108 });
    const decode = (marker: string) => JSON.parse(Buffer.from(marker, "base64url").toString("utf8")) as [number, number];
    // A marker is the place of the last event of its page: page 1 ends with event 71, page 2 with event 21.
    expect(decode(answer.history_marker)).toEqual(places[49]);
    expect(decode(pages[0]!.marker)).toEqual(places[99]);
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
      // Every node of the ledger's metadata has its index, and the delegate's root is one node.
      expect(delegateRoot.LedgerIndex).toMatch(/^[0-9A-F]{64}$/);
      expect(delegateRoot.LedgerIndex).toBe((payment!.metaData.AffectedNodes as Json[]).map((wrapper) => wrapper.ModifiedNode).find((node) => node?.FinalFields?.Account === SYNTHETIC_DELEGATE).LedgerIndex);
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

describe("the synthetic transactions", () => {
  it("serve every event of every synthetic object, its creation and its removal, each at its place in its ledger's list, the hash its serialization's", () => {
    const world = worlds.xrpl;
    let linked = 0;
    // `channel-long` is a paging fixture: its 120 events link to transactions that are not served (a controller ruling: 250 KB of links nobody follows), nor in any list.
    expect(UNSERVED_SYNTHETIC).toEqual(["channel-long"]);
    const long = world.synthetic.get("channel-long")!;
    for (const placed of world.rows.filter((row) => row.object_id === long)) {
      expect(files.has(`xrpl/data-api/transactions/${placed.tx_hash}.json`), placed.tx_hash).toBe(false);
      expect(valueAt(`xrpl/data-api/ledgers/${placed.ledger_index}@transactions=true.json`)?.ledger.transactions ?? [], placed.tx_hash).not.toContain(placed.tx_hash);
    }
    for (const [name, id] of world.synthetic) {
      if (UNSERVED_SYNTHETIC.includes(name)) continue;
      const route = name.startsWith("escrow") ? "escrows" : name.startsWith("check") ? "checks" : "payment_channels";
      const answer = valueAt(`xrpl/data-api/${route}/${id}.json`)!;
      const pages = [...answers.xrpl].filter(({ path }) => path.startsWith(`xrpl/data-api/${route}/${id}/history@`)).map(({ value }) => value as Json);
      const object = objectOf(answer);
      const hashes = [...answer.history, ...pages.flatMap((page) => page.history)].map((event: Json) => event.tx_hash as string);
      for (const ref of [object.created, object.removed]) if (ref !== undefined) expect(hashes, name).toContain(ref.tx_hash);
      for (const hash of hashes) {
        const served = valueAt(`xrpl/data-api/transactions/${hash}.json`)?.transaction as TxObject | undefined;
        expect(served, `${name} ${hash}`).toBeDefined();
        const list = valueAt(`xrpl/data-api/ledgers/${served!.ledger_index}@transactions=true.json`)!;
        expect(list.ledger.transactions[served!.meta.TransactionIndex], `${name} ${hash}`).toBe(hash);
        const blob = valueAt(`xrpl/data-api/transactions/${hash}@binary=true.json`)!.transaction.tx as string;
        expect(createHash("sha512").update(Buffer.from(TX_HASH_PREFIX + blob, "hex")).digest("hex").slice(0, 64).toUpperCase(), `${name} ${hash}`).toBe(hash);
        linked++;
      }
    }
    expect(linked).toBe(10);
    // None is in a ledger of the sets, whose lists are the recorded ones.
    const inSets = new Set(readLedgers("xrpl").map((raw) => Number(raw.ledger.ledger_index)));
    for (const placed of world.made) expect(inSets.has(Number(placed.raw.ledger.ledger_index)), placed.tx.hash).toBe(false);
  });
});

describe("D5's rules, on rows made for them", () => {
  /** A ledger of the recordings' shape, closing at `close` (Ripple epoch), and a transaction in it whose metadata is `nodes`. */
  const ledger = (close = 800_000_000): RawLedger => ({ ledger: { ledger_index: "100", close_time: close, transactions: [] } }) as unknown as RawLedger;
  const tx = (fields: Json, nodes: Json[], result = "tesSUCCESS"): RawTx =>
    ({ Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", Fee: "12", hash: "AB".repeat(32), ...fields, metaData: { AffectedNodes: nodes, TransactionIndex: 3, TransactionResult: result } }) as unknown as RawTx;
  const ID = "CD".repeat(32);
  const node = (op: string, type: string, fields: Json, previous?: Json): Json => ({
    [op]: { LedgerEntryType: type, LedgerIndex: ID, [op === "CreatedNode" ? "NewFields" : "FinalFields"]: fields, ...(previous !== undefined && { PreviousFields: previous }) },
  });
  const events = (fields: Json, nodes: Json[], result?: string) => rowsOfTransaction(ledger(), tx(fields, nodes, result)).map((row) => row.event);
  const A = { Account: "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh", Destination: "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC" };

  it.each([
    ["an escrow created by EscrowCreate", { TransactionType: "EscrowCreate", Sequence: 5 }, [node("CreatedNode", "Escrow", { ...A, Amount: "1" })], ["create"]],
    ["an escrow finished, with its fulfillment", { TransactionType: "EscrowFinish", Fulfillment: "A0028000" }, [node("DeletedNode", "Escrow", { ...A, Amount: "1" })], ["finish"]],
    ["an escrow cancelled", { TransactionType: "EscrowCancel" }, [node("DeletedNode", "Escrow", { ...A, Amount: "1" })], ["cancel"]],
    ["an escrow deleted by another transaction", { TransactionType: "AccountDelete" }, [node("DeletedNode", "Escrow", { ...A, Amount: "1" })], ["removed"]],
    ["an escrow changed by a transaction no one expects", { TransactionType: "AccountSet" }, [node("ModifiedNode", "Escrow", { ...A, Amount: "1" }, { Amount: "2" })], ["update"]],
    ["an escrow only threaded (no PreviousFields): no row", { TransactionType: "AccountSet" }, [node("ModifiedNode", "Escrow", { ...A, Amount: "1" })], []],
    ["a check created", { TransactionType: "CheckCreate", Sequence: 5 }, [node("CreatedNode", "Check", { ...A, SendMax: "1" })], ["create"]],
    ["a check cashed", { TransactionType: "CheckCash", Amount: "1" }, [node("DeletedNode", "Check", { ...A, SendMax: "1" })], ["cash"]],
    ["a check cancelled", { TransactionType: "CheckCancel" }, [node("DeletedNode", "Check", { ...A, SendMax: "1" })], ["cancel"]],
    ["a check deleted by another transaction", { TransactionType: "AccountDelete" }, [node("DeletedNode", "Check", { ...A, SendMax: "1" })], ["removed"]],
    ["a check changed", { TransactionType: "AccountSet" }, [node("ModifiedNode", "Check", { ...A, SendMax: "1" }, { SendMax: "2" })], ["update"]],
    ["a channel created", { TransactionType: "PaymentChannelCreate", Sequence: 5 }, [node("CreatedNode", "PayChannel", { ...A, Amount: "10" })], ["create"]],
    ["a channel funded", { TransactionType: "PaymentChannelFund" }, [node("ModifiedNode", "PayChannel", { ...A, Amount: "11" }, { Amount: "10" })], ["fund"]],
    ["a channel claimed", { TransactionType: "PaymentChannelClaim" }, [node("ModifiedNode", "PayChannel", { ...A, Amount: "10", Balance: "2" }, { Balance: "1" })], ["claim"]],
    ["a channel asked to close", { TransactionType: "PaymentChannelClaim", Flags: 0x00020000 }, [node("ModifiedNode", "PayChannel", { ...A, Amount: "10", Expiration: 5 }, {})], ["close_request"]],
    ["a close asked without an Expiration after it is a claim", { TransactionType: "PaymentChannelClaim", Flags: 0x00020000 }, [node("ModifiedNode", "PayChannel", { ...A, Amount: "10" }, { Balance: "1" })], ["claim"]],
    ["a channel renewed", { TransactionType: "PaymentChannelClaim", Flags: 0x00010000 }, [node("ModifiedNode", "PayChannel", { ...A, Amount: "10" }, { Expiration: 5 })], ["renew"]],
    ["a channel closed by a claim", { TransactionType: "PaymentChannelClaim" }, [node("DeletedNode", "PayChannel", { ...A, Amount: "10" })], ["close"]],
    ["a channel closed by a fund", { TransactionType: "PaymentChannelFund" }, [node("DeletedNode", "PayChannel", { ...A, Amount: "10" })], ["close"]],
    ["a channel deleted by another transaction", { TransactionType: "AccountDelete" }, [node("DeletedNode", "PayChannel", { ...A, Amount: "10" })], ["removed"]],
    ["a channel changed by another transaction", { TransactionType: "AccountSet" }, [node("ModifiedNode", "PayChannel", { ...A, Amount: "10" }, { Amount: "9" })], ["update"]],
    ["a delegation set", { TransactionType: "DelegateSet" }, [node("CreatedNode", "Delegate", { Account: A.Account, Authorize: A.Destination, Permissions: [] })], ["set"]],
    ["a delegation deleted by DelegateSet", { TransactionType: "DelegateSet" }, [node("DeletedNode", "Delegate", { Account: A.Account, Authorize: A.Destination })], ["delete"]],
    ["a delegation deleted by AccountDelete", { TransactionType: "AccountDelete" }, [node("DeletedNode", "Delegate", { Account: A.Account, Authorize: A.Destination })], ["removed"]],
    ["a delegation changed by another transaction", { TransactionType: "AccountSet" }, [node("ModifiedNode", "Delegate", { Account: A.Account, Authorize: A.Destination }, { Flags: 1 })], ["update"]],
    ["a node of another type: no row", { TransactionType: "AccountSet" }, [node("ModifiedNode", "AccountRoot", { Account: A.Account }, { Balance: "1" })], []],
  ] as const)("%s", (_what, fields, nodes, expected) => {
    expect(events(fields as Json, nodes as unknown as Json[])).toEqual(expected);
  });

  it("keeps a failed transaction's rows with its result, the facts of the event, and its delegate", () => {
    const [row] = rowsOfTransaction(
      ledger(),
      tx({ TransactionType: "CheckCash", Amount: "7", Delegate: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" }, [node("DeletedNode", "Check", { ...A, SendMax: "9" })], "tecPATH_PARTIAL"),
    );
    expect(row).toMatchObject({ event: "cash", result: "tecPATH_PARTIAL", delegate: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", event_fields: { delivered: "7" }, owner: A.Account, counterparty: A.Destination });
    // The delivered amount: the stored DeliveredAmount, else the served delivered_amount, else the cash's Amount.
    const delivered = (meta: Json) =>
      rowsOfTransaction(ledger(), { ...tx({ TransactionType: "CheckCash", Amount: "7" }, [node("DeletedNode", "Check", { ...A, SendMax: "9" })]), metaData: { AffectedNodes: [node("DeletedNode", "Check", { ...A, SendMax: "9" })], TransactionIndex: 3, TransactionResult: "tesSUCCESS", ...meta } } as unknown as RawTx)[0]!.event_fields.delivered;
    expect([delivered({ DeliveredAmount: "5", delivered_amount: "6" }), delivered({ delivered_amount: "6" }), delivered({})]).toEqual(["5", "6", "7"]);
    // A creation with no Sequence (0, no ticket) says none; a ticket's sequence is its TicketSequence.
    expect(rowsOfTransaction(ledger(), tx({ TransactionType: "EscrowCreate", Sequence: 0, TicketSequence: 9 }, [node("CreatedNode", "Escrow", { ...A, Amount: "1" })]))[0]!.event_fields).toEqual({ sequence: 9 });
    expect(rowsOfTransaction(ledger(), tx({ TransactionType: "EscrowCreate", Sequence: 0 }, [node("CreatedNode", "Escrow", { ...A, Amount: "1" })]))[0]!.event_fields).toEqual({});
  });

  it("answers an escrow's status at the as-of close time, a Ripple-epoch FinishAfter read in unix seconds", () => {
    const created = (finishAfter: number) =>
      rowsOfTransaction(ledger(), tx({ TransactionType: "EscrowCreate", Sequence: 5 }, [node("CreatedNode", "Escrow", { ...A, Amount: "1000000", FinishAfter: finishAfter })]));
    const statusAt = (finishAfter: number, closeUnix: number) =>
      (derivedAnswer("escrow", created(finishAfter), ID, { ledger_index: 100, close_time: closeUnix }, "XRP", { from_ledger_index: 100, complete: false }) as Json).escrow.status;
    const finishAfter = 800_000_100;
    expect([statusAt(finishAfter, finishAfter + 946_684_800), statusAt(finishAfter, finishAfter + 946_684_801)]).toEqual(["pending", "can_be_finished"]);
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

  it("names the e2e suite's escrows by their cases", () => {
    expect(resolveObjectCase("escrow-cancellable", sourcesOf("xrpl"))?.id).toBe(XRPL_ESCROW.cancellable);
    expect(resolveObjectCase("escrow-finished", sourcesOf("xrpl"))?.id).toBe(XRPL_ESCROW.finished);
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
