// The tags of the amendments list (validators spec 8), with the helpers of meta.ts. Only the amendments route imports this module (meta.ts says why). Like meta.ts, it
// runs in the browser too: it value-imports nothing of `ripple-*`, of the view builder or of the loader's modules (test/unit/meta-bundle.test.ts); it reads the view's
// status, which the view builder wrote.

import type { MetaDescriptor } from "react-router";

import { PRODUCT_NAME } from "../ui/brand";
import type { AmendmentsPageData } from "./amendments-view";
import { absolute, sharing, type MetaContext } from "./meta";

/**
 * The tags of `/{net}/amendments` (validators spec 8). The default view (every status) is indexable, with a canonical URL on the origin of the request and no image (a list
 * that changes with every flag ledger would have a picture out of date at once). Every other view (a status) is `noindex, follow`, with no canonical URL and no Open Graph or
 * card tags: one URL is the page, the rest are views of it. The description has no number of the data: the page is stored for a minute.
 */
export function amendmentsMeta(page: Pick<AmendmentsPageData, "status">, ctx: MetaContext): MetaDescriptor[] {
  const { network, origin } = ctx;
  const title = ["Amendments", network.name, PRODUCT_NAME].join(" · ");
  const description = `Every amendment of ${network.name}: which are enabled, which have a majority and when they activate, and how the default UNL votes on the rest.`;

  if (page.status !== undefined) {
    return [{ title }, { name: "description", content: description }, { name: "robots", content: "noindex, follow" }];
  }
  return sharing({ title, description, url: absolute(origin, `/${network.id}/amendments`) });
}
