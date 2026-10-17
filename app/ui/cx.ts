/** Class names, skipping the ones that are not strings (`cond && "is-on"`). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
