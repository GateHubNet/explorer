// What the answers of D4's two routes, `GET /v2/account_names` and `GET /v2/toml/{domain}`, must look like for the display names (E9) to use them (data-api-new
// `feat/explorer-data-2` at 3feb11a, docs/api-reference.md "Account names and tomls"; the types are in api-types.ts). Like `aggregate-shape.ts`, the data API client runs
// the checks inside the load its subrequest cache runs, as `get()`'s `finish`: a 200 that is not what the reference promises is an `UpstreamError` of kind `server`
// (status 200 marks it as an answer of the upstream), is held when the call asks, and is never stored. A check takes the whole body and what the call asked for, and
// returns the body as it is. Worker-only code, no I/O.
//
// What is checked (display-names spec 2.1):
//   - the names: `count` and the list are as long as the addresses asked, and the entry at a place is the one for the address asked at that place (a name shown against
//     another address is worse than no name); a `display_name` has text that is not empty and a `kind` that is text (a kind this build does not know is read as no name
//     later, not refused: the API may add one); `labels` is an object of labels, each with a `description` that is text (it may be empty) and a `source` and a `url` that
//     are text when there; `domain`, `account_name` and `account_network_name` are text when there. An entry may have a `domain` and no `display_name`: D4 answers so
//     when it could not read its toml store;
//   - the toml: it is the toml of the domain asked, its `status` is `ok` or `failed`, `toml_url` and `checked` are text, each list that is there is a list of objects
//     with the text that names its rows (`address`, `code`, `public_key`), and the `principals` are text. `accounts` may repeat an address (once for each counting network).
// A key the API leaves out when it has no value is checked when it is there, and `null` is never served. Extra keys are not refused.

import { fields, isName, optionalFields, rowsOf } from "./aggregate-shape";
import type { AccountNamesResponse, TomlAnswer } from "./api-types";
import { isObject, malformed } from "./tx-shape";

/** Text, which may be empty: a label's description is. */
const isText = (value: unknown): value is string => typeof value === "string";

/**
 * `GET /v2/account_names?addresses=…`: one entry for each address asked, in the order asked. `body` is what the API sent, whatever it is; it is typed as the answer
 * the check makes it.
 */
export function checkAccountNames(body: AccountNamesResponse, addresses: readonly string[]): AccountNamesResponse {
  const what = "data API account names";
  const answer: unknown = body;
  const entries = rowsOf(what, answer, "account_names");
  if ((answer as Record<string, unknown>).count !== addresses.length) throw malformed(what, `count is not ${addresses.length}, the number of addresses asked`);
  if (entries.length !== addresses.length) throw malformed(what, `account_names has ${entries.length} entries for the ${addresses.length} addresses asked`);

  for (const [index, entry] of entries.entries()) {
    const where = `account_names[${index}]`;
    if (entry.address !== addresses[index]) throw malformed(what, `${where}.address is not the address asked at that place`);

    const name = entry.display_name;
    if (name !== undefined) {
      if (!isObject(name)) throw malformed(what, `${where}.display_name is not an object`);
      fields(what, `${where}.display_name`, name, ["text"], isName, "text that is not empty");
      fields(what, `${where}.display_name`, name, ["kind"], isText, "text");
    }
    optionalFields(what, where, entry, ["domain", "account_name", "account_network_name"], isText, "text");

    const labels = entry.labels;
    if (labels !== undefined) {
      if (!isObject(labels)) throw malformed(what, `${where}.labels is not an object`);
      for (const [label, data] of Object.entries(labels)) {
        const at = `${where}.labels.${label}`;
        if (!isObject(data)) throw malformed(what, `${at} is not an object`);
        fields(what, at, data, ["description"], isText, "text");
        optionalFields(what, at, data, ["source", "url"], isText, "text");
      }
    }
  }
  return body;
}

/** The lists of a toml that name their rows by one text, and that text. */
const TOML_LISTS = [
  ["accounts", "address"],
  ["currencies", "code"],
  ["validators", "public_key"],
] as const;

/** `GET /v2/toml/{domain}`: what the toml of `domain` says. `body` is what the API sent, whatever it is; it is typed as the answer the check makes it. */
export function checkToml(body: TomlAnswer, domain: string): TomlAnswer {
  const what = "data API toml";
  const answer: unknown = body;
  const toml = isObject(answer) ? answer.toml : undefined;
  if (!isObject(toml)) throw malformed(what, "toml is not an object");

  if (toml.domain !== domain) throw malformed(what, "toml.domain is not the domain asked");
  if (toml.status !== "ok" && toml.status !== "failed") throw malformed(what, 'toml.status is neither "ok" nor "failed"');
  fields(what, "toml", toml, ["toml_url", "checked"], isText, "text");

  for (const [list, key] of TOML_LISTS) {
    if (toml[list] === undefined) continue;
    for (const [index, row] of rowsOf(what, toml, list).entries()) {
      fields(what, `toml.${list}[${index}]`, row, [key], isText, "text");
    }
  }

  const principals = toml.principals;
  if (principals !== undefined) {
    if (!Array.isArray(principals)) throw malformed(what, "toml.principals is not a list");
    for (const [index, principal] of (principals as unknown[]).entries()) {
      if (!isText(principal)) throw malformed(what, `toml.principals[${index}] is not text`);
    }
  }
  return body;
}
