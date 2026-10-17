import { describe, expect, it } from "vitest";
import { allTxs, loadTx, type FixtureSet } from "../../../test/support/ledgers";
import type { Native, TxJson, TxMeta } from "../parse/types";
import { resultText } from "../results";
import { mergeHandlers } from "./helpers";
import { describe as describeTx } from "./index";
import type { Description, Handler, Segment } from "./types";

const nativeOf = (set: FixtureSet): Native => (set === "xahau" ? "XAH" : "XRP");

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
      expect(pool).toStrictEqual({ t: "pool", v: POOL, pair: `${USDV}/${WGFS}` });
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
        label: `${USDV}/${WGFS} AMM pool`,
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
      expect(pools.map((p) => p.pair)).toStrictEqual(["524C555344000000000000000000000000000000/XPM", "XPM/589"]);
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
      expect(textOf(d.sentence)).toBe(`rwQPgn3GbhxWT8XW7So7wGiUxbWgyTjst5 tried to send 25 BXE to ${B}.`);
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
        `${A} tried to pay 5 USD to ${B}, spending up to 30 XRP.`,
      );
    });

    it("says what a failed partial payment tried to pay at most", () => {
      // Flags 131072 is tfPartialPayment; a failed payment delivered nothing, so there is no delivered amount.
      const d = run("xrpl", "EFA9C831379AD23DE46C08E92B4DB32BD12289C10E4B5BCF5E31BEF4F6A0FD31");
      expect(textOf(d.sentence)).toBe(
        "r3FZvGY7VsLez8ttA4xcKVZh9tJEnesffz tried to pay up to 0.038264 XRP to r3FZvGY7VsLez8ttA4xcKVZh9tJEnesffz, spending up to 454.5325242211337 62756C6C00000000000000000000000000000000.",
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
      "rJB8m4chXL1uC86wWpFMa5sPGg1qt1uZcV tried to offer to sell 307615.600809 47414E4700000000000000000000000000000000 for 0.111853 XRP.",
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
      "r3rhWeE31Jt5sWmi4QiGLMZnY3ENgqw96W tried to cancel offer 174683952.",
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
        `${A} tried to remove its regular key.`,
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
    expect(textOf(d.sentence)).toBe(expected);
    expect(d.ok).toBe(false);
    expect(d.flow).toBeUndefined();
  });

  it("reads 'tried to …' for a failed SignerListSet and for an unknown type", () => {
    const signers = synth("SignerListSet", {
      SignerQuorum: 1,
      SignerEntries: [{ SignerEntry: { Account: B, SignerWeight: 1 } }],
    });
    expect(textOf(describeTx(signers, FAILED, { native: "XRP" }).sentence)).toBe(
      `${A} tried to set a signer list of 1 signer, quorum 1.`,
    );
    expect(textOf(describeTx(synth("FooBar"), FAILED, { native: "XRP" }).sentence)).toBe(
      `${A} tried to submit a FooBar.`,
    );
  });

  it("takes ok from the result code, so only tesSUCCESS is ok", () => {
    for (const code of ["tesSUCCESS", "tecPATH_DRY", "tecKILLED", "tefPAST_SEQ", "terQUEUED", "tecUNKNOWN_FUTURE"]) {
      const d = describeTx(synth("FooBar"), { ...SUCCESS, TransactionResult: code }, { native: "XRP" });
      expect(d.ok).toBe(resultText(code).ok);
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
    expect(textOf(describeTx(synth("Invoke"), SUCCESS, { native: "XAH" }).sentence)).toBe(`${A} submitted an Invoke.`);
    expect(textOf(describeTx(synth("URITokenMint"), SUCCESS, { native: "XAH" }).sentence)).toBe(
      `${A} submitted a URITokenMint.`,
    );
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

describe.each<FixtureSet>(["xrpl", "xrpl-amm", "xahau"])("describe: every recorded transaction of %s", (set) => {
  const BAD = /undefined|NaN|\[object/;
  const covered = new Set([
    "Payment",
    "OfferCreate",
    "OfferCancel",
    "TrustSet",
    "AccountSet",
    "AccountDelete",
    "SetRegularKey",
    "SignerListSet",
    "TicketCreate",
  ]);

  it("never throws, and its sentence and details never say undefined", () => {
    const txs = allTxs(set);
    expect(txs.length).toBeGreaterThan(100);
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

  it("takes ok from the result code, reads 'tried to' for every failure and draws a flow for no failure", () => {
    for (const { tx, meta } of allTxs(set)) {
      const d = describeTx(tx, meta, { native: nativeOf(set) });
      expect(d.ok, tx.hash).toBe(meta.TransactionResult === "tesSUCCESS");
      expect(textOf(d.sentence).includes(" tried to "), tx.hash).toBe(!d.ok);
      if (!d.ok) expect(d.flow, tx.hash).toBeUndefined();
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
