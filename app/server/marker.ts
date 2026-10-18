// The markers of the data API's lists, as far as the explorer needs to know them. Worker-only code, no I/O.
//
// A marker is the base64url of the key of the last row of a page (api-reference.md, "Pagination"): opaque to the explorer,
// which only passes it back. It is checked for its alphabet and length before it is sent anywhere or put in a link, because
// it comes from a URL a visitor typed (or, for the next page of a CSV, from a header of the upstream).

/** The longest marker accepted. The API's are a few dozen characters. */
export const MAX_MARKER_LENGTH = 512;

const MARKER = /^[A-Za-z0-9_-]+={0,2}$/;

/** Whether `value` can be a marker: base64url text, not empty, not absurdly long. */
export function isMarker(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_MARKER_LENGTH && MARKER.test(value);
}
