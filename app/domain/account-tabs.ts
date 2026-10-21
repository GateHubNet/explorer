// The tabs of the account page and the URL of a tab or of a page of its list. Pure: the Worker builds the Newer and Older links with
// it and the page builds the links of its tabs, so it must stay small (the page runs in the browser too).

export const ACCOUNT_TABS = ["transactions", "payments", "trades", "offers", "objects", "analytics"] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];
/** The tabs that show a list. Analytics is a view of its own (`app/domain/analytics-params.ts` has its URLs). */
export type ListTab = Exclude<AccountTab, "analytics">;

export function isAccountTab(value: unknown): value is AccountTab {
  return typeof value === "string" && (ACCOUNT_TABS as readonly string[]).includes(value);
}

/** The most entries asked of the node for the objects of an account: its largest page. The Objects tab says when there are more. */
export const OBJECTS_LIMIT = 400;

/**
 * The URL of an account's tab, or of a page of its list. The first tab and the first page have none of it: there is one URL for them.
 * `back` is the trail of markers of the pages newer than `marker`, nearest first (the API's markers only run towards older rows, so
 * a page remembers how to go back in its own URL).
 */
export function accountHref(net: string, address: string, opts: { tab?: AccountTab; marker?: string; back?: readonly string[] }): string {
  const query: string[] = [];
  if (opts.tab !== undefined && opts.tab !== "transactions") query.push(`tab=${opts.tab}`);
  if (opts.marker) query.push(`marker=${encodeURIComponent(opts.marker)}`);
  if (opts.marker && opts.back && opts.back.length > 0) query.push(`back=${opts.back.map(encodeURIComponent).join(".")}`);
  return `/${net}/account/${address}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}
