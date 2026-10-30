import { formatAmount } from "../../domain/format";
import { SectionError } from "../components/SectionError";
import { useRetry } from "../use-retry";

// What the account page and its list panels both draw: a count, a count with its noun, and a list that could not be loaded. A leaf of their own, so that the
// panels (`AccountListPanels.tsx`, a chunk the page loads with `lazy()`) import nothing of `AccountPage.tsx`: a module the two shared would be a chunk the
// account route and the panels both load, and `AccountPage.tsx` is most of the route's code.

export const count = (n: number) => formatAmount(String(n));
export const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

export function ListFailed({ what }: { what: string }) {
  const { retry, retrying } = useRetry();
  return (
    <div className="activity__failed">
      <SectionError what={what} onRetry={retry} retrying={retrying} />
    </div>
  );
}
