import { describe, expect, it } from "vitest";
import { allTxs, loadManifest, loadTx, type FixtureSet } from "../../../test/support/ledgers";
import type { Native, TxJson, TxMeta } from "../parse/types";
import { formatCurrency } from "../format";
import { resultText } from "../results";
import { mergeHandlers, pairName, poolPair } from "./helpers";
import { describe as describeTx } from "./index";
import type { Description, Handler, Segment } from "./types";

const nativeOf = (set: FixtureSet): Native => (set.startsWith("xahau") ? "XAH" : "XRP");

/** A sentence as text: an account is its address, an amount `'<value> <currency>'` (raw), a pool its address. */
function textOf(segments: Segment[]): string {
  return segments
    .map((s) => {
      switch (s.t) {
        case "text":
        case "account":
        case "pool":
          return s.v;
        case "amount":
          return `${s.value} ${s.currency}`;
      }
    })
    .join("");
}

/** A sentence as a reader sees it: a pool is its pair, an amount its value and the currency as shown. */
function readOf(segments: Segment[]): string {
  return segments
    .map((s) => {
      switch (s.t) {
        case "text":
        case "account":
          return s.v;
        case "pool":
          return s.pair;
        case "amount":
          return `${s.value} ${formatCurrency(s.currency)}`;
      }
    })
    .join("");
}

function run(set: FixtureSet, hash: string): Description {
  const { tx, meta } = loadTx(set, hash);
  return describeTx(tx, meta, { native: nativeOf(set) });
}

/** The same transaction with a result code that is not a success (the fixtures are frozen; this copies). */
function failedRun(set: FixtureSet, hash: string, code = "tecKILLED"): Description {
  const { tx, meta } = loadTx(set, hash);
  return describeTx(tx, { ...meta, TransactionResult: code }, { native: nativeOf(set) });
}

const SUCCESS: TxMeta = { TransactionIndex: 0, TransactionResult: "tesSUCCESS", AffectedNodes: [] };
const FAILED: TxMeta = { ...SUCCESS, TransactionResult: "tecNO_PERMISSION" };

// What resultText says of the codes the failures below carry; a failed sentence ends with it after the full stop.
const PATH_DRY = " No path had enough liquidity to deliver the amount.";
const KILLED = " The offer could not be filled as its flags required, so nothing was traded.";
const NO_PERMISSION = " The account is not allowed to do this.";
const UNFUNDED_OFFER = " The account did not hold the asset the offer sells, so no offer was placed.";

const A = "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x";
const B = "rpj7WC49jiUU87bCATJoHFuTZDBoFEfkpa";
const K = "rKqSPjN6okYt7iPk3xzWvuW9oN1Nk7vSUV";

/** A hand-written transaction of the given type; every fixture-less case below is one of these. */
function synth(type: string, fields: Record<string, unknown> = {}): TxJson {
  return { TransactionType: type, Account: A, Fee: "10", Sequence: 7, ...fields };
}

const account = (v: string): Segment => ({ t: "account", v });
const text = (v: string): Segment => ({ t: "text", v });

describe("describe: Payment", () => {
  const NATIVE = "38D85B89F3CB0E036084946F1E38677BE418B2E13255209CB31AD3B5B6F8F6F2";
  const SENDER = "radamU8vsCW8i6DrHLhSyL1ZjZMArcFe9S";
  const RECEIVER = "ravENvULHUCrh24ZjPVSeNoUku4BtXFdRe";

  it("says a native payment sent the amount to the destination", () => {
    const d = run("xrpl", NATIVE);
    expect(textOf(d.sentence)).toBe(`${SENDER} sent 0.000107 XRP to ${RECEIVER}.`);
    expect(d.ok).toBe(true);
    expect(d.title).toBe("Payment");
  });

  it("builds the sentence from segments the page can render", () => {
    expect(run("xrpl", NATIVE).sentence).toStrictEqual([
      account(SENDER),
      text(" sent "),
      { t: "amount", value: "0.000107", currency: "XRP" },
      text(" to "),
      account(RECEIVER),
      text("."),
    ]);
  });

  it("calls the native currency XAH on Xahau", () => {
    const d = run("xahau", "00F5098EB67BB5E4E177D02F5B492DD5BF215DFF1677EFBD8542394387EBC866");
    expect(textOf(d.sentence)).toBe(
      "rGsbGtyrXoPSocAWcngrQZqm6AaQmocw5B sent 0.000001 XAH to rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto.",
    );
  });

  it("draws a direct payment as sender to destination", () => {
    expect(run("xrpl", NATIVE).flow).toStrictEqual([
      { role: "sender", account: SENDER, label: "Sender", amount: { value: "0.000107", currency: "XRP" } },
      { role: "destination", account: RECEIVER, label: "Destination", amount: { value: "0.000107", currency: "XRP" } },
    ]);
  });

  it("lists the amount, and leaves out what the payment did not set", () => {
    expect(run("xrpl", NATIVE).details).toStrictEqual([
      { label: "Amount", value: [{ t: "amount", value: "0.000107", currency: "XRP" }] },
    ]);
  });

  it("says an issued-currency payment sent the amount, with the currency code as it is", () => {
    const d = run("xrpl", "28C533CC1B9C72894AFBFCC9B4F3C7C7D210E7F2B70F6B1615805B35ED0B4BAF");
    expect(textOf(d.sentence)).toBe(
      "r3TrhyvwbwQ7aSQmAX5k7jQr6CmoN5fodq sent 0.0005 524C555344000000000000000000000000000000 to ra9b6JX5aPVbdJhogDDddsRAcasWg7gzC3.",
    );
    expect(d.sentence[2]).toStrictEqual({
      t: "amount",
      value: "0.0005",
      currency: "524C555344000000000000000000000000000000",
      issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    });
  });

  describe("cross-currency", () => {
    const SWAP = "859CC102E501BEB3B6B104FFCB4C90305940C185C15BE913EAADFBC751A1BFF9";
    const SWAPPER = "rJMp4GYhWNs5rJ2t6ioZF3EW51hvkin1z1";
    const POOL = "r9jBi69nTXhrxcZBFSkpa1WnioGt552mky";
    const USDV = "5553445600000000000000000000000000000000";
    const WGFS = "7747465300000000000000000000000000000000";

    it("says what was delivered and what was spent, and the AMM pool it went through", () => {
      const d = run("xrpl", SWAP);
      expect(textOf(d.sentence)).toBe(
        `${SWAPPER} paid 2.28441237860636 ${WGFS} to ${SWAPPER}, spending 109.3484290157 ${USDV} through the ${POOL} AMM pool.`,
      );
    });

    it("spends what the sender's balance lost, not the SendMax it allowed", () => {
      // SendMax is 109.889676402157; the sender's balance of the currency fell by 109.3484290157.
      const spending = run("xrpl", SWAP).sentence.find((s) => s.t === "amount" && s.currency === USDV);
      expect(spending).toStrictEqual({
        t: "amount",
        value: "109.3484290157",
        currency: USDV,
        issuer: "rfffsukWALJB1PXYk7H8xkR6UJUDT8nMJE",
      });
    });

    it("names the pool by its account, with the pair of currencies of the swap as its name", () => {
      const pool = run("xrpl", SWAP).sentence.find((s) => s.t === "pool");
      expect(pool).toStrictEqual({ t: "pool", v: POOL, pair: "USDV/wGFS" });
    });

    it("draws the pool between the sender and the destination", () => {
      const flow = run("xrpl", SWAP).flow!;
      expect(flow.map((step) => step.role)).toStrictEqual(["sender", "pool", "destination"]);
      expect(flow[0]).toStrictEqual({
        role: "sender",
        account: SWAPPER,
        label: "Sender",
        amount: { value: "109.3484290157", currency: USDV, issuer: "rfffsukWALJB1PXYk7H8xkR6UJUDT8nMJE" },
      });
      expect(flow[1]).toStrictEqual({
        role: "pool",
        account: POOL,
        label: "USDV/wGFS AMM pool",
        amount: { value: "2.2844123786064", currency: WGFS, issuer: "r9mf2jHSF9xGZgPxK8ziVYmcepoWYje4qV" },
      });
      expect(flow[2]).toStrictEqual({
        role: "destination",
        account: SWAPPER,
        label: "Destination",
        amount: { value: "2.28441237860636", currency: WGFS, issuer: "r9mf2jHSF9xGZgPxK8ziVYmcepoWYje4qV" },
      });
    });

    it("lists the send max and what the sender actually spent", () => {
      const labels = run("xrpl", SWAP).details.map((detail) => detail.label);
      expect(labels).toStrictEqual(["Amount", "Send max", "Spent"]);
    });

    it("leaves the pool out when the payment went through order books only", () => {
      // A cross-currency payment of the native currency for an IOU, with no pool in the metadata.
      const d = run("xrpl", "321FF4B8FF29D159DA805961F61EA3A4FDE2D12F31AE34A5FF56568C2C950BDD");
      expect(textOf(d.sentence)).toBe(
        "r589RnDpYkpMKycjF9Hmks9SKak6Jm53R paid 0.059590732563457 4245415200000000000000000000000000000000 to r589RnDpYkpMKycjF9Hmks9SKak6Jm53R, spending 0.0001 XRP.",
      );
      expect(d.sentence.some((s) => s.t === "pool")).toBe(false);
    });

    it("takes the fee out of a native spend", () => {
      // SendMax 100 drops, fee 12 drops: the sender's balance fell by 112.
      const spending = run("xrpl", "321FF4B8FF29D159DA805961F61EA3A4FDE2D12F31AE34A5FF56568C2C950BDD").sentence.find(
        (s) => s.t === "amount" && s.currency === "XRP",
      );
      expect(spending).toStrictEqual({ t: "amount", value: "0.0001", currency: "XRP" });
    });

    it("names every pool of a payment through several, in path order", () => {
      const d = run("xrpl", "B3F078BE3B9D614F20A5EADADD491AF2E92FAB9A53FFCA6113A04F99CD1AFD75");
      const pools = d.sentence.filter((s) => s.t === "pool");
      expect(pools.map((p) => p.pair)).toStrictEqual(["RLUSD/XPM", "XPM/589"]);
      expect(textOf(d.sentence)).toMatch(
        / through the rMqNVu4XZwoNcqi1SVRKDU9dpd386aZQ68 and rQJMAoBvGzrfFgvUS7JVgVtXgdWkcKKiuA AMM pools\.$/,
      );
      expect(d.flow!.map((step) => step.role)).toStrictEqual(["sender", "pool", "pool", "destination"]);
    });
  });

  describe("partial payment", () => {
    it("says what was delivered of the most the sender allowed", () => {
      // A payment of LTC with tfPartialPayment that delivered a little less than its Amount.
      const d = run("xrpl-amm", "90C01E204B7980BABCCC11746501AF3D302A2A16C9297908D38F69EB705A44A8");
      expect(textOf(d.sentence)).toBe(
        "rsTAYkk7VQfBdD5btt2WzXYphER6F2BTuN paid 0.00000006979062811565304 LTC of up to 0.00000007 LTC to rpjL9CfLwzmx9csJkdPLum7YRe99dx7MCj.",
      );
    });

    it("lists what was delivered, the tags and the flag", () => {
      const d = run("xrpl-amm", "90C01E204B7980BABCCC11746501AF3D302A2A16C9297908D38F69EB705A44A8");
      expect(d.details.map((detail) => [detail.label, textOf(detail.value)])).toStrictEqual([
        ["Amount", "0.00000007 LTC"],
        ["Delivered", "0.00000006979062811565304 LTC"],
        ["Destination tag", "104"],
        ["Source tag", "567567567"],
        ["Flags", "tfPartialPayment"],
      ]);
    });

    it("still names the AMM pool a partial payment went through", () => {
      const d = run("xrpl", "36A625708429C00F75829703C27ABD69877EC6894BE1EE4CB2A74476F3893FBA");
      expect(textOf(d.sentence)).toBe(
        "r3ASEe1LLnhfCwrHKr4Cg6YS15t52S1MK5 paid 0.145502 XRP of up to 100000 XRP to r3ASEe1LLnhfCwrHKr4Cg6YS15t52S1MK5 through the rMtcezeKUbKGnkEHbLw82VhBWx9bJ3JiQx AMM pool.",
      );
    });

    it("reads as a plain payment when the flag was set but the whole amount arrived", () => {
      // tfPartialPayment is set, and the payment delivered its full Amount: nothing partial happened.
      const d = run("xrpl", "321FF4B8FF29D159DA805961F61EA3A4FDE2D12F31AE34A5FF56568C2C950BDD");
      expect(textOf(d.sentence)).not.toContain("of up to");
      expect(d.details.find((detail) => detail.label === "Flags")?.value).toStrictEqual([text("tfPartialPayment")]);
    });
  });

  describe("failed", () => {
    it("says the sender tried to send the amount, and draws no flow", () => {
      const d = run("xrpl", "5AA87418BCF36929DBA2638FE6B83A27A6F77FDFF42F25EDB82929F0BADF9D8B");
      expect(textOf(d.sentence)).toBe(`rwQPgn3GbhxWT8XW7So7wGiUxbWgyTjst5 tried to send 25 BXE to ${B}.${PATH_DRY}`);
      expect(d.ok).toBe(false);
      expect(d.flow).toBeUndefined();
    });

    it("says what a failed cross-currency payment tried to pay and at most to spend", () => {
      const tx = synth("Payment", {
        Destination: B,
        Amount: { currency: "USD", issuer: K, value: "5" },
        SendMax: "30000000",
      });
      expect(textOf(describeTx(tx, FAILED, { native: "XRP" }).sentence)).toBe(
        `${A} tried to pay 5 USD to ${B}, spending up to 30 XRP.${NO_PERMISSION}`,
      );
    });

    it("says what a failed partial payment tried to pay at most", () => {
      // Flags 131072 is tfPartialPayment; a failed payment delivered nothing, so there is no delivered amount.
      const d = run("xrpl", "EFA9C831379AD23DE46C08E92B4DB32BD12289C10E4B5BCF5E31BEF4F6A0FD31");
      expect(textOf(d.sentence)).toBe(
        `r3FZvGY7VsLez8ttA4xcKVZh9tJEnesffz tried to pay up to 0.038264 XRP to r3FZvGY7VsLez8ttA4xcKVZh9tJEnesffz, spending up to 454.5325242211337 62756C6C00000000000000000000000000000000.${PATH_DRY}`,
      );
      expect(d.ok).toBe(false);
    });

    it("does not list what a failed payment delivered or spent", () => {
      const d = run("xrpl", "EFA9C831379AD23DE46C08E92B4DB32BD12289C10E4B5BCF5E31BEF4F6A0FD31");
      expect(d.details.map((detail) => detail.label)).toStrictEqual(["Amount", "Send max", "Flags"]);
    });
  });

  it("falls back to saying what a partial payment was allowed when the metadata has no delivered amount", () => {
    const tx = synth("Payment", { Destination: B, Amount: "5000000", Flags: 0x20000 });
    expect(textOf(describeTx(tx, SUCCESS, { native: "XRP" }).sentence)).toBe(`${A} paid up to 5 XRP to ${B}.`);
  });

  it("reads Amount from DeliverMax when a response leaves Amount out", () => {
    const tx = synth("Payment", { Destination: B, DeliverMax: "5000000" });
    expect(textOf(describeTx(tx, SUCCESS, { native: "XRP" }).sentence)).toBe(`${A} sent 5 XRP to ${B}.`);
  });

  it("ignores a delivered amount the node could not give", () => {
    const tx = synth("Payment", { Destination: B, Amount: "5000000" });
    const meta = { ...SUCCESS, delivered_amount: "unavailable" } as unknown as TxMeta;
    expect(textOf(describeTx(tx, meta, { native: "XRP" }).sentence)).toBe(`${A} sent 5 XRP to ${B}.`);
  });
});

describe("describe: offers", () => {
  const SELL = "7032CF18D20E0AB2F1E533F59A091041D39A028C3CC282855517D8BA6840803B";
  const BUY = "177A75BE449DF138934F74081F176197E0E3967AC7DDD3D50B5788571D47C666";

  it("says an offer with tfSell offered to sell TakerGets for TakerPays", () => {
    const d = run("xrpl-amm", SELL);
    expect(textOf(d.sentence)).toBe("rEJi8RgRuiABKwJxjQLvHoiHfN64CeR6e2 offered to sell 19.527672 XRP for 275.2032 CTF.");
    expect(d.ok).toBe(true);
    expect(d.title).toBe("Offer");
  });

  it("says an offer without it offered to buy TakerPays for TakerGets", () => {
    const d = run("xrpl-amm", BUY);
    expect(textOf(d.sentence)).toBe(
      "rh3VLyj1GbQjX7eA15BwUagEhSrPHmLkSR offered to buy 23186.332767 XRP for 313267.991528526 CNY.",
    );
  });

  it("lists what the offer sells and buys, the offer it replaces and its flags", () => {
    const d = run("xrpl", "1383F80F46F07054A4DA1EBAABB69B261D4A422FAEC57295C138E46989C8325A");
    expect(d.details.map((detail) => [detail.label, textOf(detail.value)])).toStrictEqual([
      ["Sells", "2854.78583 524C555344000000000000000000000000000000"],
      ["Buys", "0.03528 BTC"],
      ["Replaces offer", "89707551"],
      ["Expires", "2026-10-16 05:37:53 UTC"],
      ["Ticket sequence", "89707531"],
      ["Flags", "tfPassive"],
    ]);
  });

  it("says an offer that failed was tried", () => {
    const d = run("xrpl", "E0721233B5AF0E66BE66638D26D6DE25ED72F97860D6BD611620EB21A346E81E");
    expect(textOf(d.sentence)).toBe(
      `rJB8m4chXL1uC86wWpFMa5sPGg1qt1uZcV tried to offer to sell 307615.600809 47414E4700000000000000000000000000000000 for 0.111853 XRP.${UNFUNDED_OFFER}`,
    );
    expect(d.ok).toBe(false);
  });

  it("says an offer cancel cancelled the offer by its sequence", () => {
    const d = run("xrpl", "BAEDB3060FB6D4365B6C5E08CF94672AAD00F27D173B5428C8BAC0791A9AB050");
    expect(textOf(d.sentence)).toBe("r3rhWeE31Jt5sWmi4QiGLMZnY3ENgqw96W cancelled offer 174683952.");
    expect(d.title).toBe("Offer cancellation");
    expect(d.details).toStrictEqual([]);
  });

  it("says a failed cancel tried to cancel", () => {
    expect(textOf(failedRun("xrpl", "BAEDB3060FB6D4365B6C5E08CF94672AAD00F27D173B5428C8BAC0791A9AB050").sentence)).toBe(
      `r3rhWeE31Jt5sWmi4QiGLMZnY3ENgqw96W tried to cancel offer 174683952.${KILLED}`,
    );
  });
});

describe("describe: account types", () => {
  const TRUST_SIGMA = "002BC4AF858909F448956F5F1C51EB7B4CDD428AD8E1CD655CB4FACE9BAD8776";

  describe("TrustSet", () => {
    it("says the trust line, the issuer, the currency as shown and the limit", () => {
      const d = run("xrpl-amm", TRUST_SIGMA);
      expect(textOf(d.sentence)).toBe(
        "rKbdLadmBCKnUYV3dT4NWZQe4WpHgkkTqw set a trust line to rfKYWZ84fm9eVEdoTcsQCo1WdqMPyaUF5z for SIGMA, limit 0.",
      );
      expect(d.title).toBe("Trust line");
      expect(d.sentence[2]).toStrictEqual(account("rfKYWZ84fm9eVEdoTcsQCo1WdqMPyaUF5z"));
    });

    it("groups the limit like any other amount, and shows an LP token as one", () => {
      const d = run("xrpl-amm", "03E4104D622668AEBAD5279C25B64E5B01B7BD00307EBBDE17F2A8694526F554");
      expect(textOf(d.sentence)).toBe(
        "rKqSPjN6okYt7iPk3xzWvuW9oN1Nk7vSUV set a trust line to rGuYK1v7kyrKEa86wPN2M9CHpT9LiWFr5m for LP token, limit 141,421,357.",
      );
    });

    it("writes out a limit the ledger gives in exponent notation", () => {
      const d = run("xrpl", "8120F099EE3A6B5E3711E06B06EE050E900047DE140FF68B7976820C464F98D8");
      expect(textOf(d.sentence)).toBe(
        "rB51xJxXyuqgGcK5C63vHhCbf4mu444888 set a trust line to rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw for SOL, limit 1,000,000,000,000,000,000,000,000,000,000.",
      );
    });

    it("lists the issuer, the currency, the limit as an amount, the flags and the source tag", () => {
      const d = run("xrpl-amm", TRUST_SIGMA);
      expect(d.details).toStrictEqual([
        { label: "Issuer", value: [account("rfKYWZ84fm9eVEdoTcsQCo1WdqMPyaUF5z")] },
        { label: "Currency", value: [text("SIGMA")] },
        {
          label: "Limit",
          value: [
            {
              t: "amount",
              value: "0",
              currency: "5349474D41000000000000000000000000000000",
              issuer: "rfKYWZ84fm9eVEdoTcsQCo1WdqMPyaUF5z",
            },
          ],
        },
        { label: "Source tag", value: [text("74920348")] },
        { label: "Flags", value: [text("tfSetNoRipple, tfClearFreeze")] },
      ]);
    });
  });

  describe("AccountSet", () => {
    it("says the settings were updated, and names the flag that was set", () => {
      const d = run("xrpl-amm", "387FDEDC0589354E8E27D7312AC4C8D52118208F933C1A9FA95F93D56775FE1E");
      expect(textOf(d.sentence)).toBe("rKqSPjN6okYt7iPk3xzWvuW9oN1Nk7vSUV updated account settings.");
      expect(d.title).toBe("Account settings");
      expect(d.details).toStrictEqual([{ label: "Set flag", value: [text("asfDisableMaster")] }]);
    });

    it("has no details for an AccountSet that changes nothing", () => {
      const d = run("xrpl", "89E212177AF31831D28D898E05D7A25DE2233D162A20DB7EE77E86AEF2CAD405");
      expect(textOf(d.sentence)).toBe("rdGzD9oHEUJkiWxiuVA4UnB9f4kF7giQn updated account settings.");
      expect(d.details).toStrictEqual([]);
    });

    it("decodes the domain from hex, names SetFlag and ClearFlag, and lists the other fields it changes", () => {
      const tx = synth("AccountSet", {
        Domain: "6578616D706C652E636F6D",
        SetFlag: 8,
        ClearFlag: 9,
        EmailHash: "F9879D71855B5FF21E4963273A886BFC",
        MessageKey: "",
        TransferRate: 1005000000,
        TickSize: 5,
        NFTokenMinter: B,
        Flags: 0x10000,
      });
      const d = describeTx(tx, SUCCESS, { native: "XRP" });
      expect(d.details.map((detail) => [detail.label, textOf(detail.value)])).toStrictEqual([
        ["Domain", "example.com"],
        ["Set flag", "asfDefaultRipple"],
        ["Clear flag", "asfDepositAuth"],
        ["Email hash", "F9879D71855B5FF21E4963273A886BFC"],
        ["Message key", "removed"],
        ["Transfer rate", "0.5%"],
        ["Tick size", "5"],
        ["NFToken minter", B],
        ["Flags", "tfRequireDestTag"],
      ]);
    });

    it("says a domain that is cleared was removed, and shows hex that is not text as hex", () => {
      const cleared = describeTx(synth("AccountSet", { Domain: "" }), SUCCESS, { native: "XRP" });
      expect(textOf(cleared.details[0]!.value)).toBe("removed");
      const binary = describeTx(synth("AccountSet", { Domain: "0001FF" }), SUCCESS, { native: "XRP" });
      expect(textOf(binary.details[0]!.value)).toBe("0001FF");
    });

    it("names a flag by network, and calls one it does not know by its number", () => {
      const set = (flag: number, native: Native) =>
        textOf(describeTx(synth("AccountSet", { SetFlag: flag }), SUCCESS, { native }).details[0]!.value);
      expect(set(11, "XAH")).toBe("asfTshCollect");
      expect(set(16, "XRP")).toBe("asfAllowTrustLineClawback");
      expect(set(11, "XRP")).toBe("flag 11");
      expect(set(99, "XRP")).toBe("flag 99");
    });

    it("lists a field no setting of its own covers, as Xahau's hook parameters are", () => {
      const d = run("xahau", "2886E084FCB3B9F5901B76AAB0A175DC10457E7D54680EF52BF8ABE29690E027");
      expect(d.details.map((detail) => detail.label)).toStrictEqual(["Domain", "HookParameters"]);
      expect(textOf(d.details[0]!.value)).toMatch(/^ED503D6A06BC27A43A11/);
    });
  });

  describe("AccountDelete", () => {
    const DELETE = "8F2DCA944394B29981E24DDD6C46192C404D90F7F5FC4EAB6813B0AFD7751A2D";

    it("says the account was deleted and the rest sent to the destination", () => {
      const d = run("xrpl", DELETE);
      expect(textOf(d.sentence)).toBe(
        "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC deleted the account and sent the rest to rGCxaHPdFpkwZUxv7rCPCU8uLaavTiBqPq.",
      );
      expect(d.title).toBe("Account deletion");
    });

    it("lists the balance that was sent on", () => {
      expect(run("xrpl", DELETE).details).toStrictEqual([
        { label: "Delivered", value: [{ t: "amount", value: "1.12826", currency: "XRP" }] },
      ]);
    });

    it("draws the money going from the deleted account to the destination", () => {
      expect(run("xrpl", DELETE).flow).toStrictEqual([
        {
          role: "sender",
          account: "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC",
          label: "Sender",
          amount: { value: "1.12826", currency: "XRP" },
        },
        {
          role: "destination",
          account: "rGCxaHPdFpkwZUxv7rCPCU8uLaavTiBqPq",
          label: "Destination",
          amount: { value: "1.12826", currency: "XRP" },
        },
      ]);
    });
  });

  describe("SetRegularKey", () => {
    it("says the account set its regular key to the new one", () => {
      const d = run("xrpl-amm", "DD0B4FC1AA4D8A4E0FBEDFD591828A932FE6111F87FD5DA71CC25214075FCF42");
      expect(textOf(d.sentence)).toBe(
        "rKqSPjN6okYt7iPk3xzWvuW9oN1Nk7vSUV set its regular key to rrrrrrrrrrrrrrrrrrrrrhoLvTp.",
      );
      expect(d.title).toBe("Regular key");
      expect(d.sentence[2]).toStrictEqual(account("rrrrrrrrrrrrrrrrrrrrrhoLvTp"));
    });

    it("says it removed the regular key when none is given", () => {
      const d = describeTx(synth("SetRegularKey"), SUCCESS, { native: "XRP" });
      expect(textOf(d.sentence)).toBe(`${A} removed its regular key.`);
      expect(textOf(describeTx(synth("SetRegularKey"), FAILED, { native: "XRP" }).sentence)).toBe(
        `${A} tried to remove its regular key.${NO_PERMISSION}`,
      );
    });
  });

  describe("SignerListSet", () => {
    const entries = (...accounts: string[]) =>
      accounts.map((a, i) => ({ SignerEntry: { Account: a, SignerWeight: i + 1 } }));

    it("says the signer list, its size and the quorum", () => {
      const tx = synth("SignerListSet", { SignerQuorum: 2, SignerEntries: entries(A, B, K) });
      const d = describeTx(tx, SUCCESS, { native: "XRP" });
      expect(textOf(d.sentence)).toBe(`${A} set a signer list of 3 signers, quorum 2.`);
      expect(d.title).toBe("Signer list");
    });

    it("lists the quorum and each signer with its weight", () => {
      const tx = synth("SignerListSet", { SignerQuorum: 3, SignerEntries: entries(B, K) });
      const d = describeTx(tx, SUCCESS, { native: "XRP" });
      expect(d.details).toStrictEqual([
        { label: "Quorum", value: [text("3")] },
        { label: "Signer 1", value: [account(B), text(", weight 1")] },
        { label: "Signer 2", value: [account(K), text(", weight 2")] },
      ]);
    });

    it("says a list of one has one signer, and a quorum of 0 removes the list", () => {
      const one = synth("SignerListSet", { SignerQuorum: 1, SignerEntries: entries(B) });
      expect(textOf(describeTx(one, SUCCESS, { native: "XRP" }).sentence)).toBe(
        `${A} set a signer list of 1 signer, quorum 1.`,
      );
      const none = synth("SignerListSet", { SignerQuorum: 0 });
      expect(textOf(describeTx(none, SUCCESS, { native: "XRP" }).sentence)).toBe(`${A} removed its signer list.`);
    });
  });

  describe("TicketCreate", () => {
    it("says how many tickets were created", () => {
      const d = run("xrpl", "28B504C3D5F7EC18F39F8890DEF0941FB41637E9FA39A6BF5BB1AAB419EE2F23");
      expect(textOf(d.sentence)).toBe("r3wKiNh21bQ4rw4LNHLm85WFNsK5kfnVrj created 20 tickets.");
      expect(d.title).toBe("Tickets");
      expect(d.details).toStrictEqual([{ label: "Source tag", value: [text("19089388")] }]);
    });

    it("says one ticket, not one tickets", () => {
      const d = describeTx(synth("TicketCreate", { TicketCount: 1 }), SUCCESS, { native: "XRP" });
      expect(textOf(d.sentence)).toBe(`${A} created 1 ticket.`);
    });
  });
});

/** A hand-written transaction described the way a successful (or, with `meta`, other) one is. */
const say = (tx: TxJson, meta: TxMeta = SUCCESS, native: Native = "XRP"): Description => describeTx(tx, meta, { native });
const rows = (d: Description) => d.details.map((row) => [row.label, textOf(row.value)]);

describe("pool pair names", () => {
  const RLUSD = "524C555344000000000000000000000000000000";

  it("names a pair from its two currencies as they are shown", () => {
    expect(pairName({ currency: "XRP" }, { currency: RLUSD })).toBe("XRP/RLUSD");
    expect(pairName({ currency: "USD", issuer: K }, { currency: "XRP" })).toBe("USD/XRP");
  });

  it("shows an LP token as one, and a code that is not text as its first digits", () => {
    expect(pairName({ currency: "03930D02208264E2E40EC1B0C09E4DB96EE197B1" }, { currency: "XRP" })).toBe("LP token/XRP");
    expect(pairName({ currency: "564F58F09F97BD00000000000000000000000000" }, { currency: "XRP" })).toBe("564F58F0…/XRP");
  });

  it("names the pool of a swap by what it took in and what it paid out", () => {
    const hop = { pool: K, in: { currency: RLUSD, value: "1" }, out: { currency: "XRP", value: "2" } };
    expect(poolPair(hop)).toBe("RLUSD/XRP");
  });
});

describe("describe: escrows", () => {
  const CONDITIONAL = "E033B3615C85BF65972B7AE3569937D1135FB9E39F5F7D5F6CF7BEFF77F25FC4";
  const FINISH = "92EC1EA8B38B7242F07591AB4BF1AAB5E6B2E3015CE6E15AAAADAC05E6B74046";
  const CANCEL = "9C4D48A7F44A7A58DEBE2F31525966684E74A51F407BD7A837A41326BB3C9743";

  describe("EscrowCreate", () => {
    it("says an escrow with only a condition is locked until the condition is met", () => {
      const d = run("xrpl-extra", CONDITIONAL);
      expect(textOf(d.sentence)).toBe(
        "rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj locked 10000000 XRP for rMLNvZR9dascY5jtCfCv3whAp8HdUSZAQ, until a condition is met.",
      );
      expect(d.title).toBe("Escrow");
    });

    it("lists the amount, the destination, when it can be cancelled and the condition", () => {
      expect(rows(run("xrpl-extra", CONDITIONAL))).toStrictEqual([
        ["Amount", "10000000 XRP"],
        ["Destination", "rMLNvZR9dascY5jtCfCv3whAp8HdUSZAQ"],
        ["Cancel after", "2026-10-31 16:00:00 UTC"],
        ["Condition", "A02580202EDAC726DEA1A51D87CB3B5A1DCB8214589CC39257BF4291F33D3B629725DA64810120"],
      ]);
    });

    it("says when an escrow with a time can be released", () => {
      const tx = synth("EscrowCreate", { Amount: "5000000", Destination: B, FinishAfter: 845387999, CancelAfter: 846591350 });
      const d = say(tx);
      expect(textOf(d.sentence)).toBe(`${A} locked 5 XRP for ${B}, release after 2026-10-15 13:59:59 UTC.`);
      expect(rows(d)).toStrictEqual([
        ["Amount", "5 XRP"],
        ["Destination", B],
        ["Release after", "2026-10-15 13:59:59 UTC"],
        ["Cancel after", "2026-10-29 12:15:50 UTC"],
      ]);
    });

    it("says an escrow with a time and a condition needs both", () => {
      const tx = synth("EscrowCreate", { Amount: "5000000", Destination: B, FinishAfter: 845387999, Condition: "A0258020AB810120" });
      expect(textOf(say(tx).sentence)).toBe(
        `${A} locked 5 XRP for ${B}, release after 2026-10-15 13:59:59 UTC once a condition is met.`,
      );
    });

    it("says an escrow with neither a time nor a condition was locked for the destination", () => {
      const tx = synth("EscrowCreate", { Amount: "5000000", Destination: B, DestinationTag: 9 });
      const d = say(tx);
      expect(textOf(d.sentence)).toBe(`${A} locked 5 XRP for ${B}.`);
      expect(rows(d).map(([label]) => label)).toStrictEqual(["Amount", "Destination", "Destination tag"]);
    });

    it("says a failed escrow was tried", () => {
      const tx = synth("EscrowCreate", { Amount: { currency: "USD", issuer: K, value: "3" }, Destination: B, FinishAfter: 845387999 });
      expect(textOf(say(tx, FAILED).sentence)).toBe(
        `${A} tried to lock 3 USD for ${B}, release after 2026-10-15 13:59:59 UTC.${NO_PERMISSION}`,
      );
    });
  });

  describe("EscrowFinish", () => {
    it("says which escrow of which owner was released", () => {
      const d = run("xrpl", FINISH);
      expect(textOf(d.sentence)).toBe(
        "rDjzmUuSPJp9Evb2C7Ea8D2eTYyA5eApFP released escrow 57978925 of r3pzUULRxwRF1m5DjBWMk6FMEMwViRMCN5.",
      );
      expect(d.title).toBe("Escrow release");
      expect(d.sentence[2]).toStrictEqual(account("r3pzUULRxwRF1m5DjBWMk6FMEMwViRMCN5"));
    });

    it("lists the owner and the sequence of the escrow", () => {
      expect(rows(run("xrpl", FINISH))).toStrictEqual([
        ["Owner", "r3pzUULRxwRF1m5DjBWMk6FMEMwViRMCN5"],
        ["Escrow sequence", "57978925"],
      ]);
    });

    it("lists the condition and the fulfillment of a conditional escrow", () => {
      const tx = synth("EscrowFinish", { Owner: B, OfferSequence: 12, Condition: "A0258020AB810120", Fulfillment: "A0058003CD" });
      expect(rows(say(tx))).toStrictEqual([
        ["Owner", B],
        ["Escrow sequence", "12"],
        ["Condition", "A0258020AB810120"],
        ["Fulfillment", "A0058003CD"],
      ]);
    });

    it("says a release that failed was tried, with why (the escrow was already gone)", () => {
      const d = run("xrpl", "2822F9AB8EE2094C25A5881D3BEFDE660AE8DA5CE927B7E753C846D45C3B418C");
      expect(textOf(d.sentence)).toBe(
        `r4aXykUNCz6M6Cjmw9yYSqtSJQARqT8j8G tried to release escrow 57978925 of r3pzUULRxwRF1m5DjBWMk6FMEMwViRMCN5. ${resultText("tecNO_TARGET").text}`,
      );
      expect(d.ok).toBe(false);
    });

    it("says an escrow when the transaction does not give its sequence", () => {
      expect(textOf(say(synth("EscrowFinish", { Owner: B })).sentence)).toBe(`${A} released an escrow of ${B}.`);
    });
  });

  describe("EscrowCancel", () => {
    it("says which escrow of which owner was cancelled", () => {
      const d = run("xrpl-extra", CANCEL);
      expect(textOf(d.sentence)).toBe(
        "rsLoApP7gSVAbM16KGjGGEkAovmS6Q813r cancelled escrow 97536032 of rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj.",
      );
      expect(d.title).toBe("Escrow cancellation");
    });

    it("says a failed cancellation was tried", () => {
      expect(textOf(failedRun("xrpl-extra", CANCEL).sentence)).toBe(
        `rsLoApP7gSVAbM16KGjGGEkAovmS6Q813r tried to cancel escrow 97536032 of rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj.${KILLED}`,
      );
    });
  });
});

describe("describe: payment channels", () => {
  const CHANNEL = "5DB01B7FFED6B67E6B0414DED11E051D2EE2B7619CE0EAA6286D67A3A4D5BDB3";
  const SHORT = "channel 5DB01B\u2026BDB3";
  const KEY = "ED" + "AB".repeat(32);

  /** The metadata of a claim: the channel's balance before and after, as a modified or a deleted entry. */
  const claimMeta = (
    before: string | undefined,
    after: string,
    change: "ModifiedNode" | "DeletedNode" = "ModifiedNode",
  ): TxMeta => {
    const body = {
      LedgerEntryType: "PayChannel",
      LedgerIndex: CHANNEL,
      FinalFields: { Account: A, Destination: B, Amount: "100000000", Balance: after },
      ...(before === undefined ? {} : { PreviousFields: { Balance: before } }),
    };
    return { ...SUCCESS, AffectedNodes: [change === "ModifiedNode" ? { ModifiedNode: body } : { DeletedNode: body }] };
  };

  describe("PaymentChannelCreate", () => {
    const create = synth("PaymentChannelCreate", {
      Amount: "100000000",
      Destination: B,
      DestinationTag: 3,
      SettleDelay: 86400,
      PublicKey: KEY,
      CancelAfter: 845387999,
    });

    it("says the account opened a payment channel to the destination with the amount", () => {
      const d = say(create);
      expect(textOf(d.sentence)).toBe(`${A} opened a payment channel to ${B} with 100 XRP.`);
      expect(d.title).toBe("Payment channel");
    });

    it("lists the amount, the destination, the settle delay, the public key and when it can be cancelled", () => {
      expect(rows(say(create))).toStrictEqual([
        ["Amount", "100 XRP"],
        ["Destination", B],
        ["Destination tag", "3"],
        ["Settle delay", "86400 seconds"],
        ["Public key", KEY],
        ["Cancel after", "2026-10-15 13:59:59 UTC"],
      ]);
    });

    it("says a channel that could not be opened was tried", () => {
      expect(textOf(say(create, FAILED).sentence)).toBe(`${A} tried to open a payment channel to ${B} with 100 XRP.${NO_PERMISSION}`);
    });
  });

  describe("PaymentChannelFund", () => {
    const fund = synth("PaymentChannelFund", { Channel: CHANNEL, Amount: "25000000", Expiration: 845387999 });

    it("says the account added the amount to the channel, named by a short form of its ID", () => {
      const d = say(fund);
      expect(textOf(d.sentence)).toBe(`${A} added 25 XRP to ${SHORT}.`);
      expect(d.title).toBe("Payment channel funding");
    });

    it("lists the channel in full, the amount and the new expiry", () => {
      expect(rows(say(fund))).toStrictEqual([
        ["Channel", CHANNEL],
        ["Amount", "25 XRP"],
        ["Expires", "2026-10-15 13:59:59 UTC"],
      ]);
    });

    it("says a funding that failed was tried", () => {
      expect(textOf(say(fund, FAILED).sentence)).toBe(`${A} tried to add 25 XRP to ${SHORT}.${NO_PERMISSION}`);
    });
  });

  describe("PaymentChannelClaim", () => {
    const claim = synth("PaymentChannelClaim", { Channel: CHANNEL, Balance: "30000000", Amount: "50000000", PublicKey: KEY });

    it("says what the claim paid out: the rise of the channel's balance, not the total the claim names", () => {
      const d = say(claim, claimMeta("20000000", "30000000"));
      expect(textOf(d.sentence)).toBe(`${A} claimed 10 XRP from ${SHORT}.`);
      expect(d.title).toBe("Payment channel claim");
    });

    it("lists the total, the authorised amount and the key", () => {
      expect(rows(say(claim, claimMeta("20000000", "30000000")))).toStrictEqual([
        ["Channel", CHANNEL],
        ["Total claimed", "30 XRP"],
        ["Authorised amount", "50 XRP"],
        ["Public key", KEY],
      ]);
    });

    it("reads the balances of a channel the claim closed and removed", () => {
      const closing = { ...claim, Flags: 0x20000 };
      expect(textOf(say(closing, claimMeta("20000000", "30000000", "DeletedNode")).sentence)).toBe(
        `${A} claimed 10 XRP from ${SHORT} and closed it.`,
      );
    });

    it("says a claim that failed was tried, for the total it named", () => {
      expect(textOf(say(claim, FAILED).sentence)).toBe(`${A} tried to claim 30 XRP from ${SHORT}.${NO_PERMISSION}`);
      expect(textOf(say({ ...claim, Flags: 0x20000 }, FAILED).sentence)).toBe(
        `${A} tried to claim 30 XRP from ${SHORT} and close it.${NO_PERMISSION}`,
      );
    });

    it("falls back to the total the claim names when the metadata does not show the channel", () => {
      expect(textOf(say(claim).sentence)).toBe(`${A} claimed 30 XRP from ${SHORT}.`);
    });

    it("does not say a claim paid anything when the channel's balance did not change", () => {
      // A claim that renews the channel: the balance is unchanged, so the metadata has no previous balance.
      const renewing = synth("PaymentChannelClaim", { Channel: CHANNEL, Flags: 0x10000 });
      expect(textOf(say(renewing, claimMeta(undefined, "30000000")).sentence)).toBe(`${A} renewed ${SHORT}.`);
      expect(textOf(say(claim, claimMeta(undefined, "30000000")).sentence)).toBe(`${A} updated ${SHORT}.`);
      expect(rows(say(renewing)).at(-1)).toStrictEqual(["Flags", "tfRenew"]);
    });

    it("says a claim that only closes the channel closed it", () => {
      const closing = synth("PaymentChannelClaim", { Channel: CHANNEL, Flags: 0x20000 });
      expect(textOf(say(closing).sentence)).toBe(`${A} closed ${SHORT}.`);
      expect(textOf(say(closing, FAILED).sentence)).toBe(`${A} tried to close ${SHORT}.${NO_PERMISSION}`);
    });
  });
});

describe("describe: checks", () => {
  const CREATE = "1E39FC34D28D4E3E9A875463B07D561538E4EC0794F695A02DF2CEC7499E9BA3";
  const CASH = "A0EE5458F913A115FC3BA022BDC227FBBCE81236DDF4A6B2BEA06BAEFAA8C1CE";

  it("says a check was written to the destination for up to the send max", () => {
    const d = run("xrpl", CREATE);
    expect(textOf(d.sentence)).toBe(
      "rByxx8wgAQC7JXS1Wvm3tVEXJYSk3UxyG3 wrote a check to rNT1FNDEgQdXRrMVgiSxpgHFubMfkqoXap for up to 51 XRP.",
    );
    expect(d.title).toBe("Check");
    expect(d.sentence[2]).toStrictEqual(account("rNT1FNDEgQdXRrMVgiSxpgHFubMfkqoXap"));
  });

  it("lists the destination, the send max, the expiry, the invoice and the source tag", () => {
    expect(rows(run("xrpl-amm", "CCDBCADF2DE0EF5E85A3332C4CADE9A0C28F3B5E7220C4890E27D196415D0326"))).toStrictEqual([
      ["Destination", "rBi1QrVjwaNofisZAQnovoXdHkS73FG1tJ"],
      ["Send max", "1 524C555344000000000000000000000000000000"],
      ["Expires", "2026-10-16 17:49:51 UTC"],
      ["Invoice ID", "AB9E9A322F4A89059C5402523B218CA53745DE3672A109BD14BB1A186640AD36"],
      ["Source tag", "804681468"],
    ]);
  });

  it("says a check was cashed for the amount", () => {
    const d = run("xrpl", CASH);
    expect(textOf(d.sentence)).toBe("rrsgF9au2zTjsB6HsK8LS9B3aUjDHQKAZ6 cashed a check for 933.622827 XRP.");
    expect(d.title).toBe("Check cashing");
    expect(rows(d)).toStrictEqual([
      ["Check ID", "F53F1F3FB5630BEAEEA41F42AA110DF4068EBD227EC6C03BDED04DED76111B82"],
      ["Amount", "933.622827 XRP"],
      ["Flags", "tfInnerBatchTxn"],
    ]);
  });

  it("says a check cashed for at least the minimum when it was cashed flexibly", () => {
    const tx = synth("CheckCash", { CheckID: "AB".repeat(32), DeliverMin: { currency: "USD", issuer: K, value: "5" } });
    expect(textOf(say(tx).sentence)).toBe(`${A} cashed a check for at least 5 USD.`);
    expect(rows(say(tx))).toStrictEqual([
      ["Check ID", "AB".repeat(32)],
      ["Deliver min", "5 USD"],
    ]);
  });

  it("says a check was cancelled", () => {
    const d = run("xrpl-extra", "10CEF6273B6C4476E86169B7BB1723BF3CD2CFD948B1A732450543B2270AD87E");
    expect(textOf(d.sentence)).toBe("rPP3R33zpehB5hTy2jSYZek5ntq3HQym68 cancelled a check.");
    expect(d.title).toBe("Check cancellation");
    expect(rows(d)).toStrictEqual([["Check ID", "E6D015F4D33DB92E9DB336030C068252A2F5C535E7E76CB8ED529EF7AF144EA5"]]);
  });

  it("says a check that could not be cashed was tried", () => {
    const d = run("xrpl", "0C70E2FAAF594CA06BE0EC58A54FA88A133BDCA88895499253214F0DE9FAE79B");
    expect(textOf(d.sentence)).toBe(
      "rNT1FNDEgQdXRrMVgiSxpgHFubMfkqoXap tried to cash a check for 50 XRP. Only part of the amount could be delivered, and the payment did not allow a partial delivery.",
    );
    expect(d.ok).toBe(false);
  });
});

describe("describe: NFTs", () => {
  const MINT = "7D16D6C749CAB260C906BEC2D9CF9B37F7D1D36F26421873CF838C9BCDF056AD";
  const NFT = "00081388EF7C422EF52CEB969960BEF4144D7BC3F862C467C1B9D5C2059EB12B";

  describe("NFTokenMint", () => {
    it("says an NFT was minted, with its taxon and its transfer fee", () => {
      const d = run("xrpl", MINT);
      expect(textOf(d.sentence)).toBe("rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV minted an NFT, taxon 500, transfer fee 5%.");
      expect(d.title).toBe("NFT mint");
    });

    it("leaves the transfer fee out when there is none", () => {
      expect(textOf(say(synth("NFTokenMint", { NFTokenTaxon: 0 })).sentence)).toBe(`${A} minted an NFT, taxon 0.`);
      expect(textOf(say(synth("NFTokenMint", { NFTokenTaxon: 7, TransferFee: 0 })).sentence)).toBe(
        `${A} minted an NFT, taxon 7.`,
      );
    });

    it("writes a transfer fee in hundredths of a percent as a percentage", () => {
      const fee = (n: number) => textOf(say(synth("NFTokenMint", { NFTokenTaxon: 1, TransferFee: n })).sentence);
      expect(fee(11000)).toBe(`${A} minted an NFT, taxon 1, transfer fee 11%.`);
      expect(fee(1250)).toBe(`${A} minted an NFT, taxon 1, transfer fee 1.25%.`);
      expect(fee(50000)).toBe(`${A} minted an NFT, taxon 1, transfer fee 50%.`);
    });

    it("lists the fields of the NFT and the sell offer it was minted with", () => {
      expect(rows(run("xrpl", MINT))).toStrictEqual([
        ["Taxon", "500"],
        ["Transfer fee", "5%"],
        ["URI", "ipfs://bafybeicij5fr4u7foyub57nzgdsmfdkvkym3oly3ctm2slc5cfqy37qooy/96.json"],
        ["Issuer", "rGxWAWXg8okZh29ojBRvEMpN5peQRV16Xu"],
        ["Sell offer price", "0 XRP"],
        ["Sell offer to", "rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE"],
        ["Sell offer expires", "2026-10-29 12:15:50 UTC"],
        ["Source tag", "101102979"],
        ["Ticket sequence", "88956722"],
        ["Flags", "tfTransferable"],
      ]);
    });

    it("names the flags of an NFT that is burnable, XRP-only, trust-line and mutable", () => {
      const tx = synth("NFTokenMint", { NFTokenTaxon: 1, Flags: 0x1 | 0x2 | 0x4 | 0x8 | 0x10 });
      expect(rows(say(tx)).at(-1)).toStrictEqual(["Flags", "tfBurnable, tfOnlyXRP, tfTrustLine, tfTransferable, tfMutable"]);
    });

    it("says a mint that failed was tried", () => {
      expect(textOf(failedRun("xrpl", MINT).sentence)).toBe(
        `rKqqb5QZXVAL3VqXJL6obfRGeHou1DtyBV tried to mint an NFT, taxon 500, transfer fee 5%.${KILLED}`,
      );
    });
  });

  describe("NFTokenBurn", () => {
    it("says an NFT was burned", () => {
      const d = run("xrpl-extra", "401D8E59D6F14FD1AEC3D4A295C32D32A195AF36ECB91AAB4D3DE03D6B5C38CA");
      expect(textOf(d.sentence)).toBe("ravC5cZreMZuKEWSrpra5nkWnfzPmrabec burned an NFT.");
      expect(d.title).toBe("NFT burn");
      expect(rows(d)).toStrictEqual([["NFT", "0019000040FEFE9E7C73D4F8A4DC7A7A09DD13B724827F9429941790061B08F5"]]);
    });

    it("says whose NFT an issuer burned", () => {
      const tx = synth("NFTokenBurn", { NFTokenID: NFT, Owner: B });
      expect(textOf(say(tx).sentence)).toBe(`${A} burned an NFT owned by ${B}.`);
      expect(rows(say(tx))).toStrictEqual([
        ["NFT", NFT],
        ["Owner", B],
      ]);
    });

    it("says a failed burn was tried", () => {
      expect(textOf(say(synth("NFTokenBurn"), FAILED).sentence)).toBe(`${A} tried to burn an NFT.${NO_PERMISSION}`);
    });
  });

  describe("NFTokenCreateOffer", () => {
    it("says a sell offer offered the NFT for sale for the amount, to the destination if it names one", () => {
      const d = run("xrpl", "29A692F9CB24539AA94D059CB41CE3BE0DBA3640AFD4C0A6E9BF08DE660C3074");
      expect(textOf(d.sentence)).toBe(
        "rBUm6qAgh1TTTEwB116AuvwFYccKErBrWz offered an NFT for sale to rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC for 3 XRP.",
      );
      expect(d.title).toBe("NFT offer");
      expect(rows(d).at(-1)).toStrictEqual(["Flags", "tfSellNFToken"]);
    });

    it("says a sell offer with no destination was open to anyone", () => {
      const tx = synth("NFTokenCreateOffer", { Flags: 1, NFTokenID: NFT, Amount: "5000000" });
      expect(textOf(say(tx).sentence)).toBe(`${A} offered an NFT for sale for 5 XRP.`);
    });

    it("says a buy offer offered to buy the NFT from its owner for the amount", () => {
      const d = run("xrpl", "04DB2D79CE01AEE1233D4841FFAD2D433C1182178387700A225FD2EBCFE565C6");
      expect(textOf(d.sentence)).toBe(
        "rMTaAGVd77vAbzDv8qhoMgnZR1T5R3w6Wq offered to buy an NFT from rfTASBA5vSNaKn5myMz7qiN3ixQ46DsAzq for 14.4 XRP.",
      );
    });

    it("lists the NFT, the amount, the owner, the destination and the expiry", () => {
      const d = run("xrpl", "04DB2D79CE01AEE1233D4841FFAD2D433C1182178387700A225FD2EBCFE565C6");
      expect(rows(d)).toStrictEqual([
        ["NFT", NFT],
        ["Amount", "14.4 XRP"],
        ["Owner", "rfTASBA5vSNaKn5myMz7qiN3ixQ46DsAzq"],
        ["Destination", "rpx9JThQ2y37FaGeeJP7PXDUVEXY3PHZSC"],
        ["Expires", "2026-10-15 13:59:59 UTC"],
        ["Source tag", "101102979"],
        ["Ticket sequence", "104271664"],
      ]);
    });

    it("says a failed offer was tried", () => {
      const d = run("xrpl", "E3D5B0D261C233D9BB9B6A21668E8D6F2A47730415D79C53FBD3647825750F41");
      expect(textOf(d.sentence)).toBe(
        `rUnvhJyo4Akiq2DekSDb1Kh1wkwWXHUuxU tried to offer to buy an NFT from rJGc5vd8BefUTxoPLCdWC4NVZJwwZyekkt for 3.04767 XRP.${UNFUNDED_OFFER}`,
      );
    });
  });

  describe("NFTokenCancelOffer", () => {
    it("says how many offers were cancelled", () => {
      const d = run("xrpl", "0412FC9795FC765C183A56CDF0536BF559F4C8073E30B8A14605DAD93F001E42");
      expect(textOf(d.sentence)).toBe("rGENsWZnk2cv5aqWjzFEWxRpBnRKj4jvqL cancelled 3 NFT offers.");
      expect(d.title).toBe("NFT offer cancellation");
      expect(rows(d)).toStrictEqual([
        ["Offer 1", "CE03BA81B2C634DECB9262E003F4CE86F46FE51AF8E1305DFD5B184755229A84"],
        ["Offer 2", "4568D00FC0761C9275AC386E4ECF3DCF25D2E915CD813C03158FF5A61DFABC83"],
        ["Offer 3", "44B017460B088ADE4A5FE298602B6C90025D3DC4EE33BCAA45189B37C3AF3C61"],
      ]);
    });

    it("says one NFT offer, not one NFT offers", () => {
      const tx = synth("NFTokenCancelOffer", { NFTokenOffers: ["AB".repeat(32)] });
      expect(textOf(say(tx).sentence)).toBe(`${A} cancelled 1 NFT offer.`);
    });

    it("says it cancelled NFT offers when the transaction does not list them", () => {
      expect(textOf(say(synth("NFTokenCancelOffer")).sentence)).toBe(`${A} cancelled NFT offers.`);
    });
  });

  describe("NFTokenAcceptOffer", () => {
    it("says an accepted sell offer", () => {
      const d = run("xrpl", "423839F3B288D53874DAECE9AE3ACCE2A23E20E2C16E5DA594F425907D9E2052");
      expect(textOf(d.sentence)).toBe("rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE accepted a sell offer for an NFT.");
      expect(d.title).toBe("NFT sale");
      expect(rows(d)).toStrictEqual([
        ["Sell offer", "597C21F489133DB130FA7390B1E705310FD86A70D5EE52B2BF17C0D9ADDE942E"],
        ["Source tag", "101102979"],
        ["Flags", "tfInnerBatchTxn"],
      ]);
    });

    it("says an accepted buy offer", () => {
      const tx = synth("NFTokenAcceptOffer", { NFTokenBuyOffer: "CD".repeat(32) });
      expect(textOf(say(tx).sentence)).toBe(`${A} accepted a buy offer for an NFT.`);
    });

    it("says a broker matched a buy offer with a sell offer, and lists the broker fee", () => {
      const tx = synth("NFTokenAcceptOffer", {
        NFTokenSellOffer: "AB".repeat(32),
        NFTokenBuyOffer: "CD".repeat(32),
        NFTokenBrokerFee: "250000",
      });
      const d = say(tx);
      expect(textOf(d.sentence)).toBe(`${A} brokered the sale of an NFT.`);
      expect(rows(d)).toStrictEqual([
        ["Sell offer", "AB".repeat(32)],
        ["Buy offer", "CD".repeat(32)],
        ["Broker fee", "0.25 XRP"],
      ]);
    });

    it("says a failed acceptance was tried", () => {
      expect(
        textOf(failedRun("xrpl", "423839F3B288D53874DAECE9AE3ACCE2A23E20E2C16E5DA594F425907D9E2052").sentence),
      ).toBe(`rfxioGqxazNZt3sbeVSZtziEQBHHJAXXjE tried to accept a sell offer for an NFT.${KILLED}`);
    });
  });
});

describe("describe: AMM", () => {
  /** An AMM pool's sentence names the pool by its pair and links it by its account (a segment of its own). */
  const poolOf = (d: Description) => d.sentence.find((s) => s.t === "pool");

  describe("AMMCreate", () => {
    const CREATE = "B9A146300E7755D109BF92B6B51725B8C45BA1CCFB6683C0E01DA679B2FB0675";

    it("says the pool was created with the two amounts", () => {
      const d = run("xrpl-amm", CREATE);
      expect(readOf(d.sentence)).toBe(
        "rEh4WnsrdmE7V1XeTsWi5dM7FHH8hYuea3 created the XRP/DVR AMM pool with 500 XRP and 1000000 DVR.",
      );
      expect(d.title).toBe("AMM pool creation");
    });

    it("links the pool it created by its account", () => {
      expect(poolOf(run("xrpl-amm", CREATE))).toStrictEqual({
        t: "pool",
        v: "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG",
        pair: "XRP/DVR",
      });
    });

    it("names the pair from the two amounts, with the currencies as shown", () => {
      const d = run("xrpl", "6F152B6ED9514109B5CA4DA5A1050A5C57237BA413A12E46A7CC6E1F8FBCE977");
      expect(readOf(d.sentence)).toBe(
        "rpbq46kfJh41YsqNUaW2W7dRD2H2KBRFQt created the XRV/PLX AMM pool with 31176.958222 XRV and 27452.95114 PLX.",
      );
    });

    it("lists the amounts and the trading fee", () => {
      expect(rows(run("xrpl-amm", CREATE))).toStrictEqual([
        ["Amount", "500 XRP"],
        ["Amount 2", "1000000 DVR"],
        ["Trading fee", "1%"],
      ]);
    });

    it("says a failed creation was tried, and has no pool to link", () => {
      const tx = synth("AMMCreate", {
        Amount: "5000000",
        Amount2: { currency: "USD", issuer: K, value: "10" },
        TradingFee: 250,
      });
      const d = say(tx, FAILED);
      expect(readOf(d.sentence)).toBe(
        `${A} tried to create the XRP/USD AMM pool with 5 XRP and 10 USD.${NO_PERMISSION}`,
      );
      expect(poolOf(d)).toBeUndefined();
      expect(rows(d).at(-1)).toStrictEqual(["Trading fee", "0.25%"]);
    });
  });

  /**
   * The metadata of a two-asset deposit or withdrawal by the issuer of TOK, which is the pool's second asset: its
   * native balance and its trust line with the pool (the pool holds TOK, so the issuer's side of the line is negative),
   * before and after. `tokBefore` and `tokAfter` are the pool's holding.
   */
  const POOL_ACCOUNT = "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG";
  const issuerMeta = (xrp: [before: string, after: string], tok: [before: string, after: string]): TxMeta => ({
    ...SUCCESS,
    AffectedNodes: [
      {
        ModifiedNode: {
          LedgerEntryType: "AccountRoot",
          LedgerIndex: "11".repeat(32),
          FinalFields: { Account: A, Balance: xrp[1] },
          PreviousFields: { Balance: xrp[0] },
        },
      },
      {
        ModifiedNode: {
          LedgerEntryType: "RippleState",
          LedgerIndex: "22".repeat(32),
          FinalFields: {
            Balance: { currency: "TOK", issuer: "rrrrrrrrrrrrrrrrrrrrBZbvji", value: `-${tok[1]}` },
            LowLimit: { currency: "TOK", issuer: A, value: "0" },
            HighLimit: { currency: "TOK", issuer: POOL_ACCOUNT, value: "0" },
          },
          PreviousFields: {
            Balance: { currency: "TOK", issuer: "rrrrrrrrrrrrrrrrrrrrBZbvji", value: `-${tok[0]}` },
          },
        },
      },
      {
        ModifiedNode: {
          LedgerEntryType: "AMM",
          LedgerIndex: "33".repeat(32),
          FinalFields: { Account: POOL_ACCOUNT },
        },
      },
    ],
  });
  const issuerPair = { Asset: { currency: "XRP" }, Asset2: { currency: "TOK", issuer: A } };

  describe("AMMDeposit", () => {
    it("says what the account put in, as the metadata shows it, and links the pool", () => {
      const d = run("xrpl", "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B");
      expect(readOf(d.sentence)).toBe(
        "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x added 437.0302400914623 XLM and 60.295834 XRP to the XLM/XRP pool.",
      );
      expect(d.title).toBe("AMM deposit");
      expect(poolOf(d)).toStrictEqual({ t: "pool", v: "rprDM9hEWv7ACi1y9ZXrtRyySoWVLuU5zs", pair: "XLM/XRP" });
    });

    it("says what moved, not the most the transaction allowed", () => {
      // Amount allowed 52.400000003308 XPM; the balance fell by 52.40000000281444. Amount2 allowed 1.634445 XRP.
      const d = run("xrpl-amm", "DB7A606315913B4021A77A4F27A78CC0F66AAC65D216DC912F98E7906461D2EB");
      expect(readOf(d.sentence)).toBe(
        "ratUZ1HGd89BNGVVEkcwepHoKfFeV73omD added 52.40000000281444 XPM and 1.634445 XRP to the XPM/XRP pool.",
      );
    });

    it("says a deposit of one asset put in that asset, and leaves the LP tokens it got out", () => {
      const d = run("xrpl-amm", "94E38B2BCCA96997BCEC32925AEB289D35EC9FD67977995102D91A7E3DD71FEF");
      expect(readOf(d.sentence)).toBe(
        "rPcANyJoYnZvNP85sJZZzoXiB9Ux2gF3f added 1010 XRP to the XRP/RLUSD pool.",
      );
    });

    it("lists the amounts it allowed and its flags", () => {
      const d = run("xrpl", "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B");
      expect(rows(d)).toStrictEqual([
        ["Amount", "437.03024177231 XLM"],
        ["Amount 2", "60.295834 XRP"],
        ["Source tag", "20221212"],
        ["Flags", "tfTwoAsset"],
      ]);
    });

    it("says an issuer of one of the pool's assets put that asset in too", () => {
      // The issuer's side of its trust line with the pool has the pool as its counterparty, not the issuer.
      // It paid 5 XRP and the fee of 10 drops, and the pool's holding of TOK rose by 100.
      const tx = synth("AMMDeposit", {
        ...issuerPair,
        Amount: "5000000",
        Amount2: { currency: "TOK", issuer: A, value: "100" },
      });
      const d = say(tx, issuerMeta(["100000000", "94999990"], ["0", "100"]));
      expect(readOf(d.sentence)).toBe(`${A} added 5 XRP and 100 TOK to the XRP/TOK pool.`);
      expect(d.sentence.filter((part) => part.t === "amount")).toStrictEqual([
        { t: "amount", value: "5", currency: "XRP" },
        { t: "amount", value: "100", currency: "TOK", issuer: A },
      ]);
      expect(poolOf(d)).toStrictEqual({ t: "pool", v: POOL_ACCOUNT, pair: "XRP/TOK" });
    });

    it("says what an issuer put in of the asset it issues, not the most it allowed", () => {
      // Amount2 allows 45; the pool's holding of TOK rose by 40.
      const tx = synth("AMMDeposit", { ...issuerPair, Amount2: { currency: "TOK", issuer: A, value: "45" } });
      const d = say(tx, issuerMeta(["100000000", "99999990"], ["10", "50"]));
      expect(readOf(d.sentence)).toBe(`${A} added 40 TOK to the XRP/TOK pool.`);
    });

    it("says a failed deposit tried to add what the transaction asked for", () => {
      const d = failedRun("xrpl", "83F332E0141EF2AD30427A8476FFD8469D678321F58E649F30761A862D880A4B");
      expect(readOf(d.sentence)).toBe(
        `rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x tried to add 437.03024177231 XLM and 60.295834 XRP to the XLM/XRP pool.${KILLED}`,
      );
    });

    it("says liquidity when neither the metadata nor the transaction gives an amount", () => {
      const tx = synth("AMMDeposit", { Asset: { currency: "XRP" }, Asset2: { currency: "USD", issuer: K } });
      expect(readOf(say(tx).sentence)).toBe(`${A} added liquidity to the XRP/USD pool.`);
    });

    it("lists the LP tokens and the effective price a deposit asked for", () => {
      const tx = synth("AMMDeposit", {
        Asset: { currency: "XRP" },
        Asset2: { currency: "USD", issuer: K },
        Amount: "1000000",
        LPTokenOut: { currency: "03" + "A".repeat(38), issuer: B, value: "1500.5" },
        EPrice: { currency: "XRP", value: "0.01" },
        Flags: 0x00200000,
      });
      expect(rows(say(tx))).toStrictEqual([
        ["Amount", "1 XRP"],
        ["LP tokens out", "1,500.5 LP tokens"],
        ["Effective price", "0.01 XRP"],
        ["Flags", "tfOneAssetLPToken"],
      ]);
    });
  });

  describe("AMMWithdraw", () => {
    it("says what the account took out, as the metadata shows it", () => {
      const d = run("xrpl", "4F2B0756C721F7DAE0016F3B7481601377241BE63B8C5A1BD90F4ECA732D8CA8");
      expect(readOf(d.sentence)).toBe(
        "rhsuXNGZesfqeUtVyinrj2HcvVNqVKWUpC withdrew 15892624.14176255 PHNIX and 10513.46363006797 XRPBR from the PHNIX/XRPBR pool.",
      );
      expect(d.title).toBe("AMM withdrawal");
    });

    it("takes the fee back out of a native amount, and says what a withdraw-all gave", () => {
      // The transaction names no amounts (tfWithdrawAll). The native balance rose by 0.021962 after a fee of 0.000012.
      const d = run("xrpl-amm", "B44F14E085567F8C25DD20456FCAD9B0A289BA2EA2AB3469D6F29E582059F63F");
      expect(readOf(d.sentence)).toBe(
        "rHjzfruAe7qbEPjzvdfQ4zvjoZnQHcomwP withdrew 0.021974 XRP and 0.0000851206393053295 SNK from the XRP/SNK pool.",
      );
      expect(rows(d)).toStrictEqual([["Source tag", "10011010"], ["Flags", "tfWithdrawAll"]]);
    });

    it("leaves out an asset whose balance did not change", () => {
      // The fee was the only change of the native balance.
      const d = run("xrpl-amm", "781C5A2707D3A3E9BB00B483A8719345A6ECF0E5532E0CB5FA4016E1D5D6A832");
      expect(readOf(d.sentence)).toBe(
        "rwzSeSjHXGjTPbB5NQuqWsQnpT7Jm3rAqV withdrew 4.179818391349 USDC and 4.180497018217728 RLUSD from the USDC/RLUSD pool.",
      );
    });

    it("says an issuer of one of the pool's assets took that asset out too", () => {
      // The issuer got 5 XRP less the fee of 10 drops, and the pool's holding of TOK fell by 100.
      const tx = synth("AMMWithdraw", {
        ...issuerPair,
        Amount: "5000000",
        Amount2: { currency: "TOK", issuer: A, value: "100" },
      });
      const d = say(tx, issuerMeta(["100000000", "104999990"], ["300", "200"]));
      expect(readOf(d.sentence)).toBe(`${A} withdrew 5 XRP and 100 TOK from the XRP/TOK pool.`);
      expect(d.sentence.filter((part) => part.t === "amount")).toStrictEqual([
        { t: "amount", value: "5", currency: "XRP" },
        { t: "amount", value: "100", currency: "TOK", issuer: A },
      ]);
    });

    it("does not mistake a deposit for a withdrawal by the issuer, or the other way round", () => {
      // The pool's holding of TOK rose: nothing was withdrawn of it, so only the native amount is.
      const tx = synth("AMMWithdraw", { ...issuerPair, Amount: "5000000" });
      expect(readOf(say(tx, issuerMeta(["100000000", "104999990"], ["0", "100"])).sentence)).toBe(
        `${A} withdrew 5 XRP from the XRP/TOK pool.`,
      );
    });

    it("says a failed withdrawal tried to take out what the transaction asked for", () => {
      const tx = synth("AMMWithdraw", {
        Asset: { currency: "XRP" },
        Asset2: { currency: "USD", issuer: K },
        Amount: "7000000",
      });
      expect(readOf(say(tx, FAILED).sentence)).toBe(
        `${A} tried to withdraw 7 XRP from the XRP/USD pool.${NO_PERMISSION}`,
      );
    });
  });

  describe("AMMVote", () => {
    it("says the trading fee the account voted for, as a percentage", () => {
      const d = run("xrpl-amm", "EF35220095FC32B7036D130A460CFB31B80BAF973C0C7F7A9812B0665E33701B");
      expect(readOf(d.sentence)).toBe(
        "rthwVkuErKQtat6Sn6X2vAeveCEWfFBnt voted for a 1% trading fee in the 564F58F0…/XRP pool.",
      );
      expect(d.title).toBe("AMM vote");
      expect(poolOf(d)).toStrictEqual({
        t: "pool",
        v: "rhEypxvxNXMdMTd3GXpb6gTN1jvb4h3nef",
        pair: "564F58F0…/XRP",
      });
    });

    it("writes a fraction of a percent out", () => {
      const tx = synth("AMMVote", { Asset: { currency: "XRP" }, Asset2: { currency: "USD", issuer: K }, TradingFee: 205 });
      expect(readOf(say(tx).sentence)).toBe(`${A} voted for a 0.205% trading fee in the XRP/USD pool.`);
      expect(readOf(say(synth("AMMVote", { Asset: { currency: "XRP" }, Asset2: { currency: "USD", issuer: K }, TradingFee: 0 })).sentence)).toBe(
        `${A} voted for a 0% trading fee in the XRP/USD pool.`,
      );
    });
  });

  describe("AMMDelete", () => {
    // No AMMDelete was found in the ledgers recorded for these tests (see test/fixtures/PROVENANCE.md), so these are
    // hand-written: the transaction as rippled sends it, with the AMM entry it deletes.
    const POOL = "rUAEvY1XNvnkurE9RunV7u3yjh3jQsQPsG";
    const del = synth("AMMDelete", { Asset: { currency: "XRP" }, Asset2: { currency: "USD", issuer: K }, Flags: 0 });
    const deleted: TxMeta = {
      ...SUCCESS,
      AffectedNodes: [
        { DeletedNode: { LedgerEntryType: "AMM", LedgerIndex: "AB".repeat(32), FinalFields: { Account: POOL } } },
      ],
    };

    it("says the pool was deleted, and links it", () => {
      const d = say(del, deleted);
      expect(readOf(d.sentence)).toBe(`${A} deleted the XRP/USD pool.`);
      expect(d.title).toBe("AMM pool deletion");
      expect(poolOf(d)).toStrictEqual({ t: "pool", v: POOL, pair: "XRP/USD" });
      expect(d.details).toStrictEqual([]);
    });

    it("says a deletion that failed was tried, with no pool to link", () => {
      const d = say(del, FAILED);
      expect(readOf(d.sentence)).toBe(`${A} tried to delete the XRP/USD pool.${NO_PERMISSION}`);
      expect(poolOf(d)).toBeUndefined();
    });
  });

  describe("AMMBid", () => {
    const BID = "2D66C6FD02977F96126FB352AAD691CA556790DBF71E0CDF3B701E18A49B9427";

    it("says what the account paid for the auction slot, as the pool records it", () => {
      const d = run("xrpl-amm", BID);
      expect(readOf(d.sentence)).toBe(
        "r4S6hRiKREKkmMeqs8dpgyYAotGyck9g3h bid 294.354152174 LP tokens for the USD/XRP auction slot.",
      );
      expect(d.title).toBe("AMM auction bid");
      expect(poolOf(d)).toStrictEqual({ t: "pool", v: "rHUpaqUPbwzKZdzQ8ZQCme18FrgW9pB4am", pair: "USD/XRP" });
    });

    it("lists the bounds of the bid", () => {
      expect(rows(run("xrpl-amm", BID))).toStrictEqual([
        ["Bid min", "294.354152174 LP tokens"],
        ["Bid max", "294.354152174 LP tokens"],
      ]);
    });

    it("says what a bid allowed when the pool does not show what it paid", () => {
      const pair = { Asset: { currency: "XRP" }, Asset2: { currency: "USD", issuer: K } };
      const lp = (value: string) => ({ currency: "03" + "B".repeat(38), issuer: B, value });
      const bid = (fields: Record<string, unknown>, meta: TxMeta = SUCCESS) =>
        readOf(say(synth("AMMBid", { ...pair, ...fields }), meta).sentence);
      expect(bid({ BidMax: lp("12.5"), BidMin: lp("12.5") })).toBe(`${A} bid 12.5 LP tokens for the XRP/USD auction slot.`);
      expect(bid({ BidMax: lp("2000.25") })).toBe(`${A} bid up to 2,000.25 LP tokens for the XRP/USD auction slot.`);
      expect(bid({ BidMin: lp("3") })).toBe(`${A} bid at least 3 LP tokens for the XRP/USD auction slot.`);
      expect(bid({})).toBe(`${A} bid for the XRP/USD auction slot.`);
      expect(bid({ BidMax: lp("9") }, FAILED)).toBe(
        `${A} tried to bid up to 9 LP tokens for the XRP/USD auction slot.${NO_PERMISSION}`,
      );
    });

    it("lists the accounts that can use the slot's discount", () => {
      const tx = synth("AMMBid", {
        Asset: { currency: "XRP" },
        Asset2: { currency: "USD", issuer: K },
        AuthAccounts: [{ AuthAccount: { Account: B } }, { AuthAccount: { Account: K } }],
      });
      expect(rows(say(tx))).toStrictEqual([["Auth accounts", `${B}, ${K}`]]);
    });
  });
});

describe("describe: Xahau types", () => {
  const xah = (tx: TxJson, meta: TxMeta = SUCCESS) => say(tx, meta, "XAH");
  const EVR = { currency: "EVR", issuer: "rEvernodee8dJLaFsujS6q1EiXvZYmHXr8" };
  const TOKEN = "93344C2AA1E84ADF70D9ADBB14DEEF3BC9EC9502FB6D5C84E23851AF8EDFDED0";

  describe("ClaimReward", () => {
    it("says the account claimed balance rewards", () => {
      const d = run("xahau", "3A1F25CDF0E2E4466AA0B019EA3039A6E5F87C01FBDD69CBDC474DAC32D8E64C");
      expect(textOf(d.sentence)).toBe("rDitc4S7Y1GF2yzM4S2dayA4jYuK6YewSz claimed balance rewards.");
      expect(d.title).toBe("Reward claim");
      expect(rows(d)).toStrictEqual([["Issuer", "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"]]);
    });

    it("says an account that sets tfOptOut opted out of them", () => {
      const d = xah(synth("ClaimReward", { Flags: 1 }));
      expect(textOf(d.sentence)).toBe(`${A} opted out of balance rewards.`);
      expect(rows(d)).toStrictEqual([["Flags", "tfOptOut"]]);
    });
  });

  describe("Invoke", () => {
    it("says the account invoked the destination", () => {
      const d = run("xahau", "016888802E183D84F6D2A6D8541469B793A6C4775B0D3606979DD1B406E0BE96");
      expect(textOf(d.sentence)).toBe("rEQVMoFt3iHxZkgYjYFZcF5LEqSG5eKAYm invoked rsfTBRAbD2bYjVuXhJ2RReQXxR4K5birVW.");
      expect(d.title).toBe("Invoke");
    });

    it("says the account invoked its own hooks when there is no destination", () => {
      expect(textOf(xah(synth("Invoke")).sentence)).toBe(`${A} invoked its own hooks.`);
      expect(textOf(xah(synth("Invoke"), FAILED).sentence)).toBe(`${A} tried to invoke its own hooks.${NO_PERMISSION}`);
    });

    it("lists the destination, the size of the blob and the hook parameters", () => {
      const d = run("xahau", "016888802E183D84F6D2A6D8541469B793A6C4775B0D3606979DD1B406E0BE96");
      expect(rows(d)).toStrictEqual([
        ["Destination", "rsfTBRAbD2bYjVuXhJ2RReQXxR4K5birVW"],
        ["Blob", "66 bytes"],
        ["Hook parameters", "2 parameters"],
      ]);
    });
  });

  describe("SetHook", () => {
    const REAL = "01A4FDA81686D9AA9AD53C82CB36CE6377CB91374B3CA8AC858198D100E45275";
    const HASH = "610F33B8EBF7EC795F822A454FB852156AEFE50BE0CB8326338A81CD74801864";

    it("says how many hooks were set, and how many were removed", () => {
      // One slot installs code; the other three have an empty CreateCode, which is how a hook is removed.
      const d = run("xahau-extra", REAL);
      expect(textOf(d.sentence)).toBe("rMEqg6FDiM4Xd8AA8AjfBUunpjhb8fqXwP set 1 hook and removed 3 hooks.");
      expect(d.title).toBe("Hooks");
    });

    it("lists what each slot does", () => {
      expect(rows(run("xahau-extra", REAL))).toStrictEqual([
        ["Hook 1", "installs 627 bytes of code, namespace 2BC6C2\u20265507, hsfOVERRIDE"],
        ["Hook 2", "removes the hook"],
        ["Hook 3", "removes the hook"],
        ["Hook 4", "removes the hook"],
      ]);
    });

    it("counts the slots that set a hook, by code or by the hash of a hook already installed, and not the empty ones", () => {
      const tx = synth("SetHook", { Hooks: [{ Hook: { HookHash: HASH } }, { Hook: {} }, { Hook: { CreateCode: "ABCD" } }] });
      const d = xah(tx);
      expect(textOf(d.sentence)).toBe(`${A} set 2 hooks.`);
      expect(rows(d)).toStrictEqual([
        ["Hook 1", "uses hook 610F33\u20261864"],
        ["Hook 3", "installs 2 bytes of code"],
      ]);
    });

    it("says one hook, or only a removal, or none", () => {
      const hooks = (...entries: unknown[]) => textOf(xah(synth("SetHook", { Hooks: entries })).sentence);
      expect(hooks({ Hook: { CreateCode: "AB" } })).toBe(`${A} set 1 hook.`);
      expect(hooks({ Hook: { CreateCode: "", Flags: 1 } })).toBe(`${A} removed 1 hook.`);
      expect(hooks({ Hook: {} })).toBe(`${A} set no hooks.`);
      expect(textOf(xah(synth("SetHook")).sentence)).toBe(`${A} set no hooks.`);
    });

    it("says a failed SetHook was tried", () => {
      const d = failedRun("xahau-extra", REAL);
      expect(textOf(d.sentence)).toBe(
        `rMEqg6FDiM4Xd8AA8AjfBUunpjhb8fqXwP tried to set 1 hook and remove 3 hooks.${KILLED}`,
      );
    });
  });

  describe("URIToken", () => {
    it("says a URIToken was minted, and lists its URI", () => {
      const d = run("xahau", "0EE5BE5020FE2A4D26618868DCFCC5E11191C99104614C14558E68FECC425BCA");
      expect(textOf(d.sentence)).toBe("r3qv4CerAysTRhpDN5C3ZDDuNc57HUoxCo minted a URIToken.");
      expect(d.title).toBe("URIToken mint");
      expect(d.details.map((row) => row.label)).toStrictEqual(["URI", "Flags"]);
      expect(rows(d).at(-1)).toStrictEqual(["Flags", "tfBurnable"]);
    });

    it("lists the digest, the destination and the price of a URIToken minted for sale", () => {
      const tx = synth("URITokenMint", { URI: "68747470733A2F2F7878", Digest: "AB".repeat(32), Destination: B, Amount: "5000000" });
      expect(rows(xah(tx))).toStrictEqual([
        ["URI", "https://xx"],
        ["Digest", "AB".repeat(32)],
        ["Destination", B],
        ["Amount", "5 XAH"],
      ]);
    });

    it("says a URIToken was burned", () => {
      const d = run("xahau", "0BF65D795D3834F11D6BB6D199ABDE3E4CF2855CE47282DF6C9AB4AE927CB09C");
      expect(textOf(d.sentence)).toBe("r4rPJ2bexLhT7tyN8dR14yyymLpikLhLj6 burned a URIToken.");
      expect(rows(d)).toStrictEqual([["URIToken ID", "885E39BB29B9B650221736CA52D7C99C9516E705A2C55F1DF44A612CA9078A60"]]);
    });

    it("says a URIToken was bought for the amount", () => {
      const d = run("xahau", "0057C0432B29EB6A583F011CC4849C44AEC840561B1AADFD3CE3C51086534249");
      expect(textOf(d.sentence)).toBe("rkZPXKbG6ieWS4EZkYMjeqpNb1ipEdKq3 bought a URIToken for 0.017 EVR.");
      expect(d.title).toBe("URIToken purchase");
      expect(rows(d)).toStrictEqual([
        ["URIToken ID", "4747D7A9464AB3C6970EBFA7F2062FA9ED2DE4D90BCEFE6AB8723A244C9D210E"],
        ["Amount", "0.017 EVR"],
        ["Hook parameters", "1 parameter"],
      ]);
    });

    it("says a URIToken was offered for sale for the amount", () => {
      const d = run("xahau", "DFC5EC12CECC042D57F3D6C7643B962EFD842F33A476AB9986A1A24DF8065701");
      expect(textOf(d.sentence)).toBe("r3qv4CerAysTRhpDN5C3ZDDuNc57HUoxCo offered a URIToken for sale for 0.00001 EVR.");
      expect(d.title).toBe("URIToken sell offer");
    });

    it("says to whom a URIToken was offered when the offer names a buyer", () => {
      const tx = synth("URITokenCreateSellOffer", { URITokenID: TOKEN, Amount: { ...EVR, value: "3" }, Destination: B });
      expect(textOf(xah(tx).sentence)).toBe(`${A} offered a URIToken for sale to ${B} for 3 EVR.`);
      expect(rows(xah(tx))).toStrictEqual([
        ["URIToken ID", TOKEN],
        ["Amount", "3 EVR"],
        ["Destination", B],
      ]);
    });

    // Neither URITokenCancelSellOffer nor Import was found in the ledgers recorded for these tests (see
    // test/fixtures/PROVENANCE.md), so the two below are hand-written, as the node sends them.
    it("says the sale of a URIToken was cancelled", () => {
      const d = xah(synth("URITokenCancelSellOffer", { URITokenID: TOKEN }));
      expect(textOf(d.sentence)).toBe(`${A} cancelled the sale of a URIToken.`);
      expect(d.title).toBe("URIToken sell offer cancellation");
      expect(rows(d)).toStrictEqual([["URIToken ID", TOKEN]]);
      expect(textOf(xah(synth("URITokenCancelSellOffer", { URITokenID: TOKEN }), FAILED).sentence)).toBe(
        `${A} tried to cancel the sale of a URIToken.${NO_PERMISSION}`,
      );
    });

    it("says a failed purchase was tried", () => {
      const d = failedRun("xahau", "0057C0432B29EB6A583F011CC4849C44AEC840561B1AADFD3CE3C51086534249");
      expect(textOf(d.sentence)).toBe(`rkZPXKbG6ieWS4EZkYMjeqpNb1ipEdKq3 tried to buy a URIToken for 0.017 EVR.${KILLED}`);
    });
  });

  describe("Import", () => {
    it("says the account imported a transaction from another network", () => {
      const tx = synth("Import", { Issuer: B, Blob: "7B22".padEnd(4000, "0") });
      const d = xah(tx);
      expect(textOf(d.sentence)).toBe(`${A} imported a transaction from another network.`);
      expect(d.title).toBe("Import");
      expect(rows(d)).toStrictEqual([
        ["Issuer", B],
        ["Blob", "2000 bytes"],
      ]);
      expect(textOf(xah(tx, FAILED).sentence)).toBe(
        `${A} tried to import a transaction from another network.${NO_PERMISSION}`,
      );
    });
  });

  describe("Remit", () => {
    const REMIT = "8C50C44787A12B785AA62377D0AFA6C4711E8E07EF68BA6E83DC286F7EE79AAF";

    it("says the account remitted the amounts to the destination", () => {
      const d = run("xahau", REMIT);
      expect(textOf(d.sentence)).toBe(
        "rDripFkNyrKz7XUEWKCa18aTeGQ9mi7afj remitted 0.116634 XAH, 0.01138 EVR, 0.16672 XXX and 0.011506 RVN to rE8CnkPE7KY3MFurBUSEZdm8aFrehqUsWy.",
      );
      expect(d.title).toBe("Remit");
    });

    it("says one amount alone, and two with an 'and'", () => {
      const remit = (...amounts: unknown[]) =>
        textOf(xah(synth("Remit", { Destination: B, Amounts: amounts.map((Amount) => ({ AmountEntry: { Amount } })) })).sentence);
      expect(remit("2000000")).toBe(`${A} remitted 2 XAH to ${B}.`);
      expect(remit("2000000", { ...EVR, value: "1" })).toBe(`${A} remitted 2 XAH and 1 EVR to ${B}.`);
    });

    it("counts the URITokens it sends along", () => {
      const tx = synth("Remit", { Destination: B, Amounts: [{ AmountEntry: { Amount: "1000000" } }], URITokenIDs: [TOKEN, "CD".repeat(32)] });
      expect(textOf(xah(tx).sentence)).toBe(`${A} remitted 1 XAH and 2 URITokens to ${B}.`);
      const one = synth("Remit", { Destination: B, URITokenIDs: [TOKEN] });
      expect(textOf(xah(one).sentence)).toBe(`${A} remitted 1 URIToken to ${B}.`);
    });

    it("says only that it remitted to the destination when nothing is listed", () => {
      expect(textOf(xah(synth("Remit", { Destination: B })).sentence)).toBe(`${A} remitted to ${B}.`);
    });

    it("lists the destination, each amount, the URITokens and the inform account", () => {
      const tx = synth("Remit", {
        Destination: B,
        Amounts: [{ AmountEntry: { Amount: "1000000" } }, { AmountEntry: { Amount: { ...EVR, value: "4" } } }],
        URITokenIDs: [TOKEN],
        Inform: K,
        DestinationTag: 5,
      });
      expect(rows(xah(tx))).toStrictEqual([
        ["Destination", B],
        ["Destination tag", "5"],
        ["Amount 1", "1 XAH"],
        ["Amount 2", "4 EVR"],
        ["URIToken 1", TOKEN],
        ["Inform", K],
      ]);
    });

    it("says a failed remit was tried", () => {
      const tx = synth("Remit", { Destination: B, Amounts: [{ AmountEntry: { Amount: "2000000" } }] });
      expect(textOf(xah(tx, FAILED).sentence)).toBe(`${A} tried to remit 2 XAH to ${B}.${NO_PERMISSION}`);
    });
  });
});

/** The transaction types spec 7.3 covers in v1 (the account, offer and payment types are in `covered` below too). */
const V1_TYPES = [
  "Payment", "OfferCreate", "OfferCancel", "TrustSet", "AccountSet", "AccountDelete", "SetRegularKey", "SignerListSet",
  "EscrowCreate", "EscrowFinish", "EscrowCancel", "PaymentChannelCreate", "PaymentChannelFund", "PaymentChannelClaim",
  "CheckCreate", "CheckCash", "CheckCancel", "TicketCreate",
  "NFTokenMint", "NFTokenBurn", "NFTokenCreateOffer", "NFTokenCancelOffer", "NFTokenAcceptOffer",
  "AMMCreate", "AMMDeposit", "AMMWithdraw", "AMMVote", "AMMBid", "AMMDelete",
  "ClaimReward", "SetHook", "Invoke", "URITokenMint", "URITokenBurn", "URITokenBuy", "URITokenCreateSellOffer",
  "URITokenCancelSellOffer", "Remit", "Import",
] as const;

describe.each<FixtureSet>(["xrpl-extra", "xahau-extra"])("the recorded %s set", (set) => {
  it("holds a successful transaction of every type its manifest says it found, and none of those it says it missed", () => {
    const manifest = loadManifest(set);
    expect(Object.keys(manifest.found).length).toBeGreaterThan(0);
    for (const [type, { hash }] of Object.entries<{ hash: string }>(manifest.found)) {
      const { tx, meta } = loadTx(set, hash);
      expect(tx.TransactionType).toBe(type);
      expect(meta.TransactionResult, type).toBe("tesSUCCESS");
    }
    const types = new Set(allTxs(set).map(({ tx }) => tx.TransactionType));
    for (const type of manifest.missing as string[]) expect(types.has(type), type).toBe(false);
  });
});

describe("describe: every type of spec 7.3", () => {
  it.each(V1_TYPES)("has its own handler for %s, which copes with a transaction that has no fields", (type) => {
    for (const meta of [SUCCESS, FAILED]) {
      const d = say(synth(type), meta, "XAH");
      const everything = [readOf(d.sentence), ...d.details.flatMap((row) => [row.label, readOf(row.value)])];
      for (const piece of everything) expect(piece, `${type} ${meta.TransactionResult}`).not.toMatch(/undefined|NaN|\[object/);
      expect(readOf(d.sentence), type).not.toMatch(/submit/);
      expect(readOf(d.sentence), type).toMatch(meta === SUCCESS ? /\.$/ : / tried to /);
    }
  });
});

describe("describe: a failed transaction", () => {
  it.each([
    [
      "Payment",
      "xrpl",
      "38D85B89F3CB0E036084946F1E38677BE418B2E13255209CB31AD3B5B6F8F6F2",
      "radamU8vsCW8i6DrHLhSyL1ZjZMArcFe9S tried to send 0.000107 XRP to ravENvULHUCrh24ZjPVSeNoUku4BtXFdRe.",
    ],
    [
      "OfferCreate with tfSell",
      "xrpl-amm",
      "7032CF18D20E0AB2F1E533F59A091041D39A028C3CC282855517D8BA6840803B",
      "rEJi8RgRuiABKwJxjQLvHoiHfN64CeR6e2 tried to offer to sell 19.527672 XRP for 275.2032 CTF.",
    ],
    [
      "OfferCreate",
      "xrpl-amm",
      "177A75BE449DF138934F74081F176197E0E3967AC7DDD3D50B5788571D47C666",
      "rh3VLyj1GbQjX7eA15BwUagEhSrPHmLkSR tried to offer to buy 23186.332767 XRP for 313267.991528526 CNY.",
    ],
    [
      "TrustSet",
      "xrpl-amm",
      "002BC4AF858909F448956F5F1C51EB7B4CDD428AD8E1CD655CB4FACE9BAD8776",
      "rKbdLadmBCKnUYV3dT4NWZQe4WpHgkkTqw tried to set a trust line to rfKYWZ84fm9eVEdoTcsQCo1WdqMPyaUF5z for SIGMA, limit 0.",
    ],
    [
      "AccountSet",
      "xrpl-amm",
      "387FDEDC0589354E8E27D7312AC4C8D52118208F933C1A9FA95F93D56775FE1E",
      "rKqSPjN6okYt7iPk3xzWvuW9oN1Nk7vSUV tried to update account settings.",
    ],
    [
      "AccountDelete",
      "xrpl",
      "8F2DCA944394B29981E24DDD6C46192C404D90F7F5FC4EAB6813B0AFD7751A2D",
      "r3CgerzsDtZhh3ejvDjZJUKqXqRVWQcnNC tried to delete the account and send the rest to rGCxaHPdFpkwZUxv7rCPCU8uLaavTiBqPq.",
    ],
    [
      "SetRegularKey",
      "xrpl-amm",
      "DD0B4FC1AA4D8A4E0FBEDFD591828A932FE6111F87FD5DA71CC25214075FCF42",
      "rKqSPjN6okYt7iPk3xzWvuW9oN1Nk7vSUV tried to set its regular key to rrrrrrrrrrrrrrrrrrrrrhoLvTp.",
    ],
    [
      "TicketCreate",
      "xrpl",
      "28B504C3D5F7EC18F39F8890DEF0941FB41637E9FA39A6BF5BB1AAB419EE2F23",
      "r3wKiNh21bQ4rw4LNHLm85WFNsK5kfnVrj tried to create 20 tickets.",
    ],
  ] as const)("reads 'tried to …' for a failed %s", (_label, set, hash, expected) => {
    const d = failedRun(set, hash);
    // failedRun gives the transaction tecKILLED.
    expect(textOf(d.sentence)).toBe(expected + KILLED);
    expect(d.ok).toBe(false);
    expect(d.flow).toBeUndefined();
  });

  it("reads 'tried to …' for a failed SignerListSet and for an unknown type", () => {
    const signers = synth("SignerListSet", {
      SignerQuorum: 1,
      SignerEntries: [{ SignerEntry: { Account: B, SignerWeight: 1 } }],
    });
    expect(textOf(describeTx(signers, FAILED, { native: "XRP" }).sentence)).toBe(
      `${A} tried to set a signer list of 1 signer, quorum 1.${NO_PERMISSION}`,
    );
    expect(textOf(describeTx(synth("FooBar"), FAILED, { native: "XRP" }).sentence)).toBe(
      `${A} tried to submit a FooBar.${NO_PERMISSION}`,
    );
  });

  it("ends a failed sentence with the text of its result, as a segment of its own after the full stop", () => {
    const d = run("xrpl", "5AA87418BCF36929DBA2638FE6B83A27A6F77FDFF42F25EDB82929F0BADF9D8B");
    expect(d.result).toStrictEqual({
      code: "tecPATH_DRY",
      ok: false,
      text: "No path had enough liquidity to deliver the amount.",
    });
    expect(d.sentence.at(-1)).toStrictEqual(text(PATH_DRY));
    expect(d.sentence.at(-2)).toStrictEqual(text("."));
  });

  it("explains a result code with no sentence of its own by its class and the code", () => {
    const meta = { ...SUCCESS, TransactionResult: "tecFOO_BAR" };
    const d = describeTx(synth("FooBar"), meta, { native: "XRP" });
    expect(textOf(d.sentence)).toBe(`${A} tried to submit a FooBar. Failed, but the fee was charged (tec code tecFOO_BAR).`);
    expect(d.result).toStrictEqual({
      code: "tecFOO_BAR",
      ok: false,
      text: "Failed, but the fee was charged (tec code tecFOO_BAR).",
    });
  });

  it("carries the result of a success, and leaves its sentence as it was", () => {
    const d = run("xrpl", "38D85B89F3CB0E036084946F1E38677BE418B2E13255209CB31AD3B5B6F8F6F2");
    expect(d.result).toStrictEqual({
      code: "tesSUCCESS",
      ok: true,
      text: "The transaction was applied and is final.",
    });
    expect(d.ok).toBe(d.result.ok);
    expect(d.sentence.at(-1)).toStrictEqual(text("."));
  });

  it("takes ok from the result code, so only tesSUCCESS is ok", () => {
    for (const code of ["tesSUCCESS", "tecPATH_DRY", "tecKILLED", "tefPAST_SEQ", "terQUEUED", "tecUNKNOWN_FUTURE"]) {
      const d = describeTx(synth("FooBar"), { ...SUCCESS, TransactionResult: code }, { native: "XRP" });
      expect(d.ok).toBe(resultText(code).ok);
      expect(d.result).toStrictEqual({ code, ...resultText(code) });
    }
  });
});

describe("describe: an unknown type", () => {
  const FOO = synth("FooBar", {
    SigningPubKey: "ED00",
    TxnSignature: "AB12",
    Flags: 0,
    LastLedgerSequence: 99,
    hash: "F".repeat(64),
    Foo: "bar",
    Count: 5,
    Owner: B,
    Amount: "2000000",
    Settings: { Deep: 1 },
  });

  it("says the account submitted one", () => {
    const d = describeTx(FOO, SUCCESS, { native: "XRP" });
    expect(textOf(d.sentence)).toBe(`${A} submitted a FooBar.`);
    expect(d.ok).toBe(true);
    expect(d.title).toBe("FooBar");
    expect(d.flow).toBeUndefined();
  });

  it("lists every field but the common ones", () => {
    const d = describeTx(FOO, SUCCESS, { native: "XRP" });
    expect(d.details).toStrictEqual([
      { label: "Foo", value: [text("bar")] },
      { label: "Count", value: [text("5")] },
      { label: "Owner", value: [account(B)] },
      { label: "Amount", value: [{ t: "amount", value: "2", currency: "XRP" }] },
      { label: "Settings", value: [text('{"Deep":1}')] },
    ]);
  });

  it("says 'an' before a type that starts with a vowel", () => {
    expect(textOf(describeTx(synth("Ephemeral"), SUCCESS, { native: "XAH" }).sentence)).toBe(`${A} submitted an Ephemeral.`);
    expect(textOf(describeTx(synth("URIFoo"), SUCCESS, { native: "XAH" }).sentence)).toBe(`${A} submitted a URIFoo.`);
  });

  it("does not take a name from Object.prototype for a handler", () => {
    for (const type of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const d = describeTx(synth(type), SUCCESS, { native: "XRP" });
      expect(textOf(d.sentence)).toBe(`${A} submitted a ${type}.`);
    }
  });

  it("describes a recorded Batch as an unknown type", () => {
    const batch = allTxs("xrpl").find(({ tx }) => tx.TransactionType === "Batch")!;
    const d = describeTx(batch.tx, batch.meta, { native: "XRP" });
    expect(textOf(d.sentence)).toBe(`${batch.tx.Account} submitted a Batch.`);
    expect(d.details.length).toBeGreaterThan(0);
  });
});

describe("mergeHandlers", () => {
  const one: Handler = () => ({ title: "One", predicate: [] });
  const two: Handler = () => ({ title: "Two", predicate: [] });

  it("merges the handler maps of several modules", () => {
    expect(mergeHandlers({ One: one }, { Two: two })).toStrictEqual({ One: one, Two: two });
  });

  it("refuses two handlers for one transaction type", () => {
    expect(() => mergeHandlers({ One: one }, { One: two })).toThrow(/One/);
  });
});

describe.each<FixtureSet>(["xrpl", "xrpl-amm", "xahau", "xrpl-extra", "xahau-extra"])("describe: every recorded transaction of %s", (set) => {
  const BAD = /undefined|NaN|\[object/;
  const covered = new Set<string>(V1_TYPES);

  it("never throws, and its sentence and details never say undefined", () => {
    const txs = allTxs(set);
    // The extra sets are a few ledgers each, and Xahau ledgers are small.
    expect(txs.length).toBeGreaterThan(set.endsWith("-extra") ? 0 : 100);
    for (const { tx, meta } of txs) {
      const d = describeTx(tx, meta, { native: nativeOf(set) });
      const everything = [textOf(d.sentence), ...d.details.flatMap((detail) => [detail.label, textOf(detail.value)])];
      for (const piece of everything) {
        expect(piece, `${tx.hash} ${tx.TransactionType}`).not.toMatch(BAD);
      }
    }
  });

  it("starts every sentence with the sender, and ends it with a full stop", () => {
    for (const { tx, meta } of allTxs(set)) {
      const d = describeTx(tx, meta, { native: nativeOf(set) });
      expect(d.sentence[0], tx.hash).toStrictEqual(account(tx.Account));
      expect(textOf(d.sentence), tx.hash).toMatch(/\.$/);
    }
  });

  it("gives every transaction its result, and ends every failure with the text of that result", () => {
    for (const { tx, meta } of allTxs(set)) {
      const d = describeTx(tx, meta, { native: nativeOf(set) });
      const expected = resultText(meta.TransactionResult);
      expect(d.result, tx.hash).toStrictEqual({ code: meta.TransactionResult, ...expected });
      expect(d.result.code, tx.hash).toBe(meta.TransactionResult);
      expect(d.ok, tx.hash).toBe(d.result.ok);
      const last = d.sentence.at(-1)!;
      if (d.ok) {
        // A success says nothing of its result: the sentence ends at its full stop.
        expect(textOf(d.sentence), tx.hash).not.toContain(expected.text);
        expect(last.t === "text" && last.v.endsWith("."), tx.hash).toBe(true);
      } else {
        // A failure's sentence ends at its full stop too, and the text of the result follows as a segment of its own.
        expect(last, tx.hash).toStrictEqual(text(` ${expected.text}`));
        const stop = d.sentence.at(-2)!;
        expect(stop.t === "text" && stop.v.endsWith("."), tx.hash).toBe(true);
      }
    }
  });

  it("takes ok from the result code, reads 'tried to' for every failure and draws a flow for no failure", () => {
    for (const { tx, meta } of allTxs(set)) {
      const d = describeTx(tx, meta, { native: nativeOf(set) });
      expect(d.ok, tx.hash).toBe(meta.TransactionResult === "tesSUCCESS");
      expect(textOf(d.sentence).includes(" tried to "), tx.hash).toBe(!d.ok);
      if (!d.ok) expect(d.flow, tx.hash).toBeUndefined();
    }
  });

  it("never leaves a past tense after 'tried to', which means a handler forgot to put its verb through verb()", () => {
    // A heuristic: "tried to <word>ed ". A real infinitive that ends in -ed (need, proceed, ...) goes in here.
    const INFINITIVES = new Set<string>();
    const PAST = /\btried to (\w+ed)\b/g;
    for (const { tx, meta } of allTxs(set)) {
      // Every transaction as it reads when it fails, not only the ones that did, so each handler's failure path runs.
      for (const code of [meta.TransactionResult, "tecKILLED"]) {
        const d = describeTx(tx, { ...meta, TransactionResult: code }, { native: nativeOf(set) });
        if (d.ok) continue;
        for (const [, word] of textOf(d.sentence).matchAll(PAST)) {
          expect(INFINITIVES.has(word!), `${tx.hash} ${tx.TransactionType}: tried to ${word}`).toBe(true);
        }
      }
    }
  });

  it("describes the covered types with their own handler", () => {
    for (const { tx, meta } of allTxs(set)) {
      if (!covered.has(tx.TransactionType)) continue;
      const d = describeTx(tx, meta, { native: nativeOf(set) });
      expect(textOf(d.sentence), tx.hash).not.toMatch(/submit/);
    }
  });

  it("gives every flow a sender first and a destination last, and every amount a plain number", () => {
    for (const { tx, meta } of allTxs(set)) {
      const d = describeTx(tx, meta, { native: nativeOf(set) });
      if (!d.flow) continue;
      expect(d.flow[0]!.role, tx.hash).toBe("sender");
      expect(d.flow.at(-1)!.role, tx.hash).toBe("destination");
      for (const step of d.flow) {
        if (step.amount) expect(step.amount.value, tx.hash).toMatch(/^-?\d+(\.\d+)?(e-?\d+)?$/i);
      }
    }
  });
});
