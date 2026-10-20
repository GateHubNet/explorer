import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { serverThenHydrated } from "../../test/support/hydrate";
import { useHydrated } from "./use-hydrated";

// What only a script can do is left out of the Worker's HTML and of the first render in the browser, so that the two match: the cursor of
// the chart kit, and on the markets page the text filter, the sort buttons and "Show all".

function Hydrated() {
  return <output>{String(useHydrated())}</output>;
}

describe("useHydrated", () => {
  it("is false in the Worker's HTML and during hydration, and true after", async () => {
    expect(renderToString(<Hydrated />)).toContain("false");
    const { html, container, errors } = await serverThenHydrated(<Hydrated />);
    expect(html).toContain("false");
    expect(container.textContent).toBe("true");
    expect(errors).toEqual([]);
  });
});
