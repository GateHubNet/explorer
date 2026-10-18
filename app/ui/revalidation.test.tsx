import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData, useRouteError, type ShouldRevalidateFunctionArgs } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createOnScreen } from "./on-screen";
import { onlyWhenParamsChange } from "./revalidation";

afterEach(cleanup);

const args = (over: Partial<ShouldRevalidateFunctionArgs>) =>
  ({ currentParams: { net: "xrpl" }, nextParams: { net: "xrpl" }, defaultShouldRevalidate: true, ...over }) as ShouldRevalidateFunctionArgs;

describe("onlyWhenParamsChange", () => {
  it("asks for a layout's data again when its URL parameters changed, and not when they did not", () => {
    expect(onlyWhenParamsChange(args({}))).toBe(false);
    expect(onlyWhenParamsChange(args({ nextParams: { net: "xahau" } }))).toBe(true);
    expect(onlyWhenParamsChange(args({ nextParams: { net: "xrpl", id: "5" } }))).toBe(true);
  });

  it("never says yes when React Router already said no", () => {
    expect(onlyWhenParamsChange(args({ nextParams: { net: "xahau" }, defaultShouldRevalidate: false }))).toBe(false);
  });
});

// What React Router does with a page that asks for its data again and is refused (the home page, every 4 s): a loader that throws drops the
// route's data and shows the nearest error boundary in place of the route and everything below it. The layout of `/:net` has the boundary
// that brings the page frame; it is what a visitor would see in place of the home page. `createOnScreen` and `onlyWhenParamsChange` are
// what keep the page instead (app/routes/net._index.tsx and net.tsx).
describe("a page that revalidates, in a layout with an error boundary", () => {
  function setup(options: { keep: boolean }) {
    const runs = { layout: 0, page: 0 };
    let failing = false;
    const onScreen = createOnScreen<string>();

    function Page() {
      const shown = useLoaderData() as string;
      useEffect(() => onScreen.show("xrpl", shown), [shown]);
      return <p>page {shown}</p>;
    }
    const load = async () => {
      runs.page += 1;
      if (failing) throw new Response("busy", { status: 503 });
      return `v${runs.page}`;
    };
    const router = createMemoryRouter(
      [
        {
          id: "layout",
          path: "/:net",
          loader: () => (runs.layout += 1),
          shouldRevalidate: options.keep ? onlyWhenParamsChange : undefined,
          Component: () => (
            <div>
              <p>layout</p>
              <Outlet />
            </div>
          ),
          ErrorBoundary: () => <p>error screen {String((useRouteError() as Response).status)}</p>,
          children: [{ id: "page", index: true, loader: options.keep ? () => onScreen.reload("xrpl", async () => load()) : load, Component: Page }],
        },
      ],
      { initialEntries: ["/xrpl"] },
    );
    render(<RouterProvider router={router} />);
    return {
      router,
      runs,
      fail: (value: boolean) => (failing = value),
      revalidate: async () => {
        act(() => void router.revalidate());
        await waitFor(() => expect(router.state.revalidation).toBe("idle"));
      },
    };
  }

  it("keeps the page, and does not ask for the layout again, when the revalidation fails; and goes on when it works again", async () => {
    const t = setup({ keep: true });
    expect(await screen.findByText("page v1")).toBeTruthy();

    await t.revalidate();
    expect(screen.getByText("page v2")).toBeTruthy();
    t.fail(true);
    await t.revalidate();
    await t.revalidate();
    expect(screen.getByText("page v2")).toBeTruthy();
    expect(screen.queryByText(/error screen/)).toBeNull();
    t.fail(false);
    await t.revalidate();
    expect(screen.getByText("page v5")).toBeTruthy();
    // The layout's data is its URL's: it was asked for once.
    expect(t.runs.layout).toBe(1);
  });

  it("is the error screen without them: a failed revalidation takes the page away", async () => {
    const t = setup({ keep: false });
    expect(await screen.findByText("page v1")).toBeTruthy();
    t.fail(true);
    await t.revalidate();
    expect(screen.getByText("error screen 503")).toBeTruthy();
    expect(screen.queryByText(/page v/)).toBeNull();
    expect(t.runs.layout).toBe(2);
  });
});
