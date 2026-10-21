// The tags of the validators list (validators spec 8), with the helpers of meta.ts. Only the validators route imports this module (meta.ts says
// why). Like meta.ts, it runs in the browser too: it value-imports nothing of `ripple-*`, of the view builder or of the loader's modules
// (test/unit/meta-bundle.test.ts); it reads the view's params, which the view builder wrote.

import type { MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../ui/brand";
import { absolute, sharing, type MetaContext } from "./meta";
import type { ValidatorsPageData } from "./validators-view";

/**
 * The tags of `/{net}/validators` (validators spec 8). The default view (the UNL, no filter) is indexable, with a canonical URL on the origin of
 * the request and no image (a list that changes with every ledger would have a picture out of date at once). Every other view (the All scope, a
 * publisher, an amendment, a search) is `noindex, follow`, with no canonical URL and no Open Graph or card tags: one URL is the page, the rest are
 * views of it. The description has no number of the data: the page is stored for seconds.
 */
export function validatorsMeta(page: Pick<ValidatorsPageData, "params">, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const { scope, publisher, amendment, q } = page.params;
  const title = ["Validators", network.name, PRODUCT_NAME].join(" · ");
  const description = `The validators of ${network.name}: the default UNL and every validator seen in the last 24 hours, with their domains, software versions, agreement, and fee and amendment votes.`;

  if (scope !== "unl" || publisher !== undefined || amendment !== undefined || q !== undefined) {
    return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  }
  return sharing({ title, description, url: absolute(origin, `/${network.id}/validators`) });
}
