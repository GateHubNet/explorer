import { cleanup, render } from "@testing-library/react";
import { Fragment, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { nameViewOf, type NameMap } from "../domain/names";
import { NamesProvider, useNameOf } from "./names";

afterEach(cleanup);

// The names of the page's addresses, for the components that draw an account (E9, spec 4): a context the page's loader data fills, read by address.
// Fictional names and `*.example` domains.
const A = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const B = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const C = "rrrrrrrrrrrrrrrrrrrrBZbvji";

const view = (address: string, text: string, kind: "verified" | "account", domain?: string) =>
  nameViewOf({ address, display_name: { text, kind }, ...(domain ? { domain } : {}) })!;

const OUTER: NameMap = { [A]: view(A, "Northpeak Treasury", "verified", "northpeak.example"), [B]: view(B, "Harborline Exchange", "account") };
const INNER: NameMap = { [B]: view(B, "Harborline Markets", "account"), [C]: view(C, "Copperfield Payments", "verified", "copperfield.example") };

/** The name of an address, or `-` for none. */
function Name({ address }: { address: string }) {
  return <>{useNameOf(address)?.name?.text ?? "-"}</>;
}

/** The name of each address, or `-` for none, divided by `|`. */
function Probe({ addresses }: { addresses: readonly string[] }) {
  return (
    <p>
      {addresses.map((address, i) => (
        <Fragment key={address}>
          {i > 0 && "|"}
          <Name address={address} />
        </Fragment>
      ))}
    </p>
  );
}

/** What `ui` writes. */
const textOf = (ui: ReactElement) => render(ui).container.textContent;

describe("useNameOf", () => {
  it("is undefined outside a provider, for every address", () => {
    expect(textOf(<Probe addresses={[A, B]} />)).toBe("-|-");
  });

  it("is the view of the address in the provider's map, and undefined for an address that is not in it", () => {
    const text = textOf(
      <NamesProvider names={OUTER}>
        <Probe addresses={[A, B, C]} />
      </NamesProvider>,
    );
    expect(text).toBe("Northpeak Treasury|Harborline Exchange|-");
  });

  it("does not take a property of Object.prototype for a view", () => {
    const text = textOf(
      <NamesProvider names={OUTER}>
        <Probe addresses={["constructor", "__proto__", "toString"]} />
      </NamesProvider>,
    );
    expect(text).toBe("-|-|-");
  });

  it("is the same view object the map holds, so that a page re-rendering with the same map renders the same", () => {
    let seen: unknown;
    function Capture() {
      seen = useNameOf(A);
      return null;
    }
    render(
      <NamesProvider names={OUTER}>
        <Capture />
      </NamesProvider>,
    );
    expect(seen).toBe(OUTER[A]);
  });
});

describe("NamesProvider", () => {
  it("adds to the outer provider's map: the outer entries stay, and the inner ones win for an address both have", () => {
    const text = textOf(
      <NamesProvider names={OUTER}>
        <NamesProvider names={INNER}>
          <Probe addresses={[A, B, C]} />
        </NamesProvider>
      </NamesProvider>,
    );
    expect(text).toBe("Northpeak Treasury|Harborline Markets|Copperfield Payments");
  });

  it("leaves the outer map as it was outside the inner provider", () => {
    const { container } = render(
      <NamesProvider names={OUTER}>
        <NamesProvider names={INNER}>
          <Probe addresses={[B]} />
        </NamesProvider>
        <Probe addresses={[B, C]} />
      </NamesProvider>,
    );
    expect(Array.from(container.querySelectorAll("p"), (p) => p.textContent)).toEqual(["Harborline Markets", "Harborline Exchange|-"]);
  });

  it("with an empty map, shows what the outer one does", () => {
    const text = textOf(
      <NamesProvider names={OUTER}>
        <NamesProvider names={{}}>
          <Probe addresses={[A]} />
        </NamesProvider>
      </NamesProvider>,
    );
    expect(text).toBe("Northpeak Treasury");
  });

  it("prints on the server what the browser renders: the context is read, not fetched", () => {
    const html = renderToString(
      <NamesProvider names={OUTER}>
        <Probe addresses={[A]} />
      </NamesProvider>,
    );
    expect(html).toBe("<p>Northpeak Treasury</p>");
  });
});
