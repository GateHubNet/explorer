// The tags of a validator's page (validators spec 8), with the helpers of meta.ts. Only the validator route imports this module (meta.ts says why). Like
// meta.ts, it runs in the browser too: it value-imports nothing of `ripple-*`, of the view builder or of the loader's modules (test/unit/meta-bundle.test.ts);
// it reads what the view builder wrote.

import type { MetaDescriptor } from "react-router";

import { listedByText } from "../domain/publishers";
import { absolute, imageUrl, sharing, suffixOf, type MetaContext } from "./meta";
import type { ValidatorPageData } from "./validator-view";

/** What the description says of the check of the domain: nothing for a domain not checked yet, and for no domain. */
const DOMAIN_WORDS = { verified: " Its domain is verified.", unverified: " Its domain is not verified." } as const;

/**
 * The tags of `/{net}/validators/{key}` (validators spec 8). The live view is indexable, with a canonical URL on the origin of the request and the
 * link-preview image of the validator (`/og/{net}/validator/{master key}.png`). A page of older validations (`?marker=`) is `noindex, follow`, with no
 * canonical URL and no Open Graph or card tags. The description has no age and no number that moves with the chain: the page is stored for seconds.
 */
export function validatorMeta(page: ValidatorPageData, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const name = page.identity.heading.text;
  const title = `Validator ${name} · ${suffixOf(network)}`;

  if (page.kind === "history") {
    // No canonical URL: Google advises against `noindex` on a page that names another URL as its canonical, and the two disagree.
    return [
      { title },
      { name: "description", content: `Older validations of the validator ${name} on ${network.name}.` },
      { name: "robots", content: "noindex, follow" },
    ];
  }

  const { publishers, version, domain } = page.meta;
  const unl = page.identity.unl ? `, on the default UNL${publishers.length > 0 ? ` (${listedByText(publishers)})` : ""}` : "";
  const running = version === null ? "" : `, running ${page.network.software} ${version}`;
  const checked = domain === null ? "" : DOMAIN_WORDS[domain];
  return sharing({
    title,
    description: `${name} is a validator of ${network.name}${unl}${running}.${checked} Agreement, fee and amendment votes, and recent validations.`,
    url: absolute(origin, `/${network.id}/validators/${page.key}`),
    image: { url: imageUrl(origin, network.id, "validator", page.key), alt: `Validator ${name} on ${network.name}` },
  });
}
