// What the specs of the validators and amendments pages share (validators.spec.ts, amendments.spec.ts, validators-live.spec.ts and a11y.spec.ts's
// block of them). The validators, keys and amendments a test looks at are read from the pages, never written here, so that the suite runs against a
// real stack as it does against the fixtures; the one exception is the validator whose older validations the fixtures hold (`withHistory`).

import { readdirSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";

import { featuresOff } from "../../scripts/e2e-env";
import { LIVE } from "./fixtures";
import { expect, hydrated } from "./support";

/** Whether the Worker under test has the validators pages off (`E2E_FEATURES_OFF` lists `VALIDATORS`): the tests of the pages skip themselves. */
export const VALIDATORS_OFF = featuresOff(process.env).has("VALIDATORS");

export const SKIP_OFF = "VALIDATORS is off in the Worker under test: the off-case is checked in validators.spec.ts";

/** The rows of a table, without its head. */
export const rowsOf = (table: Locator) => table.locator('[role="row"]:not(.table__head)');

/** The validators list's table. */
export const validatorsTable = (page: Page) => page.getByRole("table", { name: "Validators" });

/** A validator of the list, as its row says it: the key of its page (the end of the link's `href`), the link's text and the `href`. */
export interface Listed {
  key: string;
  name: string;
  href: string;
}

async function listedOf(row: Locator): Promise<Listed> {
  const link = row.locator("a.validators__name");
  const href = (await link.getAttribute("href"))!;
  return { key: decodeURIComponent(href.slice(href.lastIndexOf("/") + 1)), name: (await link.textContent())!.trim(), href };
}

/**
 * Opens a view of the validators list (`/xrpl/validators` by default) and gives the first validator whose row matches `which`: `verified` (its domain's
 * check says "verified", not "not verified"), `no domain` (the line under its name says so), or any.
 */
export async function listedValidator(page: Page, which: "verified" | "no domain" | "any" = "any", path = "/xrpl/validators"): Promise<Listed> {
  await page.goto(path);
  await hydrated(page);
  const rows = rowsOf(validatorsTable(page));
  await expect(rows.first()).toBeVisible();
  const matching =
    which === "verified"
      ? rows.filter({ has: page.locator(".validators__marks .st", { hasText: /^verified$/ }) })
      : which === "no domain"
        ? rows.filter({ has: page.locator(".validators__sub", { hasText: /^no domain$/ }) })
        : rows;
  return listedOf(matching.first());
}

/**
 * A validator whose page has older validations to page to. The fixtures hold one page of them for one XRPL validator (the generator's marker page),
 * found where they are; against a real stack every validator that signs has them, and the first of the list is taken.
 */
export async function withHistory(page: Page): Promise<string> {
  if (LIVE) return (await listedValidator(page)).key;
  const directory = new URL("../fixtures/http/xrpl/data-api/network/validators/", import.meta.url);
  const keys = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => readdirSync(new URL(`${entry.name}/`, directory)).some((file) => file.startsWith("validations@limit=20&marker=")))
    .map((entry) => entry.name);
  expect(keys, "the fixtures hold one validator's older validations").toHaveLength(1);
  return keys[0]!;
}

/** The amendments list's table. */
export const amendmentsTable = (page: Page) => page.getByRole("table", { name: "Amendments" });

/**
 * The first amendment of a view of the amendments list (`?status=…`), as the link to its page; `null` when the view has none (a real stack may have no
 * amendment with a majority, or none of an unknown name).
 */
export async function listedAmendment(page: Page, status: "majority" | "voting" | "enabled" | "unknown", net = "xrpl"): Promise<{ name: string; href: string } | null> {
  await page.goto(`/${net}/amendments?status=${status}`);
  await hydrated(page);
  const links = rowsOf(amendmentsTable(page)).locator("a.amendments__name");
  if ((await links.count()) === 0) return null;
  return { name: (await links.first().textContent())!.trim(), href: (await links.first().getAttribute("href"))! };
}

/** The head of the document as the browser has it now: what a search engine and a link preview would read. */
export const headOf = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
    title: document.title,
  }));
