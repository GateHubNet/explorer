// Plain-language text for transaction result codes (`tesSUCCESS`, `tecPATH_DRY`, ...). Pure: the
// browser and the Worker both import this file.
//
// Statuses are shown as an icon and text, so `ok` says which icon, and `text` is the sentence.

export type ResultText = { ok: boolean; text: string };

/** What the codes mean in the ledger, in one sentence each. The fallback is `CLASS_TEXT`. */
const KNOWN: Record<string, string> = {
  tesSUCCESS: "The transaction was applied and is final.",

  // tec: applied to the ledger and the fee was charged, but the transaction did nothing else.
  tecPATH_DRY: "No path had enough liquidity to deliver the amount.",
  tecPATH_PARTIAL:
    "Only part of the amount could be delivered, and the payment did not allow a partial delivery.",
  tecUNFUNDED_OFFER: "The account did not hold the asset the offer sells, so no offer was placed.",
  tecUNFUNDED_PAYMENT: "The sender did not have enough funds to make the payment.",
  tecNO_DST: "The destination account does not exist.",
  tecNO_DST_INSUF_XRP:
    "The destination account does not exist, and the amount was too small to fund its reserve.",
  tecNO_LINE: "The trust line this transaction needs does not exist.",
  tecINSUF_RESERVE_LINE: "The account could not cover the reserve for a new trust line.",
  tecINSUF_RESERVE_OFFER: "The account could not cover the reserve for a new offer.",
  tecKILLED: "The offer could not be filled as its flags required, so nothing was traded.",
  tecNO_PERMISSION: "The account is not allowed to do this.",
  tecDST_TAG_NEEDED: "The destination requires a destination tag, and none was given.",
  tecEXPIRED: "The offer, check or other object this refers to has expired.",
  tecHAS_OBLIGATIONS: "The account still owns objects or has obligations, so it cannot be deleted.",
  tecOVERSIZE: "The result would exceed a size limit of the ledger, such as too many entries.",
  tecAMM_BALANCE: "The AMM pool does not hold enough of an asset for this operation.",
  tecAMM_FAILED: "A condition of the AMM operation, such as a minimum amount, was not met.",
  tecUNFUNDED: "The account does not have enough funds for this transaction.",
  tecINSUFF_FEE: "The account could not pay the fee of this transaction.",
  tecINSUFFICIENT_RESERVE: "The account could not cover the reserve this transaction needs.",
  tecNO_ISSUER: "The issuer of the asset does not exist.",
  tecNO_AUTH: "The issuer has not authorised this account to hold the asset.",
  tecFROZEN: "The asset or the trust line is frozen.",
  tecDIR_FULL: "The account or a book has no room for another entry.",
  tecNO_ENTRY: "A ledger entry this transaction needs does not exist.",
  tecDUPLICATE: "The ledger entry this transaction would create already exists.",
  tecOWNERS: "The account still owns objects that must be removed first.",

  // tef: the transaction can never succeed in the current ledger or on a retry.
  tefPAST_SEQ: "The sequence number was already used by an earlier transaction.",
  tefMAX_LEDGER: "The transaction's last allowed ledger has passed.",

  // ter: no ledger change yet; the transaction may succeed if it is retried.
  terQUEUED: "The transaction is held in the queue and may be applied in a later ledger.",
  terPRE_SEQ: "The sequence number is ahead of the account's; earlier transactions must go first.",

  // tel: the server that received the transaction would not take it; nothing was relayed.
  telINSUF_FEE_P: "The fee is too low for the server to accept the transaction right now.",
};

/**
 * One sentence per class, for a code with no sentence of its own. The code is appended to it, so
 * the reader (and a bug report) still has the exact result.
 */
const CLASSES = {
  tes: { ok: true, stem: "The transaction was applied" },
  tec: { ok: false, stem: "Failed, but the fee was charged" },
  tef: { ok: false, stem: "The transaction was not applied and can never succeed in its current form" },
  tel: {
    ok: false,
    stem: "The transaction was not applied: the server that received it rejected it locally",
  },
  tem: { ok: false, stem: "The transaction was not applied because it is malformed" },
  ter: {
    ok: false,
    stem: "The transaction was not applied yet, and may succeed if it is retried",
  },
} as const;

type ResultClass = keyof typeof CLASSES;

/**
 * The plain-language meaning of a transaction result code. `ok` is true for the success class only
 * (`tesSUCCESS` is its one member); every other class means the transaction did not do its job.
 * A code with no sentence of its own gets its class's, and a code of no class is called unknown.
 */
export function resultText(code: string): ResultText {
  const known = Object.hasOwn(KNOWN, code) ? KNOWN[code] : undefined;
  const cls = /^(tes|tec|tef|tel|tem|ter)(?=[A-Z])/.exec(code)?.[1] as ResultClass | undefined;

  if (cls === undefined) {
    return { ok: false, text: code ? `Unknown result code ${code}.` : "Unknown result code." };
  }
  const { ok, stem } = CLASSES[cls];
  return { ok, text: known ?? `${stem} (${cls} code ${code}).` };
}
