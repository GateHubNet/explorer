import { useId, type ReactNode } from "react";
import { Link } from "react-router";

import type { TextPart } from "../../server/validator-facts";
import type { TomlCardView, ValidatorLiveData } from "../../server/validator-view";
import { AccountLink } from "../components/AccountLink";
import { ExternalLink } from "../components/ExternalLink";
import { CheckIcon } from "../components/icons";
import { Parts } from "../components/StatusMarks";

// What a verified domain's toml says of its validator (E13 spec 5.1): the card between the identity and the agreement tiles. It draws `data.toml`, the text and hrefs `tomlCardOf` made,
// and never fetches: its account names come from the page's `NamesProvider`, as the accounts line's did.

/** The source line of the cards drawn from D, the validator (as ValidatorPage.tsx has it). */
const DETAIL_SOURCE = "/v2/network/validators/{key}";

type Net = ValidatorLiveData["network"]["id"];

/** A fact's value: its parts, the last of them in mono when the builder says so (the whole network value, the host after "Yes · "). */
function FactValue({ parts, mono }: { parts: readonly TextPart[]; mono: boolean }) {
  if (!mono) return <Parts parts={parts} />;
  const last = parts[parts.length - 1];
  return (
    <>
      <Parts parts={parts.slice(0, -1)} />
      {typeof last === "string" ? <span className="mono">{last}</span> : last !== undefined && <Parts parts={[last]} />}
    </>
  );
}

function Facts({ facts }: { facts: NonNullable<TomlCardView["facts"]> }) {
  return (
    <div className="validator__tomlgrid">
      {facts.map((fact) => (
        <div key={fact.label} className="validator__fact">
          <span className="validator__label">{fact.label}</span>
          <span className="validator__value">
            <FactValue parts={fact.value} mono={fact.mono} />
          </span>
          {fact.sub !== null && (
            <span className="validator__sub">
              <Parts parts={fact.sub} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A list of the card, named by its label (`[[ACCOUNTS]]`, `[[CURRENCIES]]` in mono, as the toml writes them): the count first, the items, and the sentence that says how many more there are. */
function TomlList({ label, section, lead, more, children }: { label: string; section: string; lead?: string; more: string | null; children: ReactNode }) {
  const id = useId();
  return (
    <div className="validator__tomllist" role="group" aria-labelledby={id}>
      <span id={id} className="validator__label">
        {label} <span className="mono">{section}</span>
      </span>
      <span className="validator__tomlitems">
        {lead !== undefined && <span className="validator__tomlcount">{lead}</span>}
        {children}
        {more !== null && <span className="validator__tomlcount">{more}</span>}
      </span>
    </div>
  );
}

/**
 * The toml card (spec 5.1): the head with the link to the file, the two checks the domain passed, the facts the file gives (or the sentence that D8 has not read them yet), and under a rule the
 * lists of the accounts it names and its currencies, each left out when the builder gave none. `net` is the page's network, for the account links.
 */
export function ValidatorTomlCard({ card, net }: { card: TomlCardView; net: Net }) {
  const { accounts, currencies } = card;
  return (
    <section className="card validator__toml" aria-labelledby="validator-toml-title">
      <div className="validator__cardhead">
        <div className="chart__titles">
          <h2 id="validator-toml-title" className="chart__title">
            {card.title}
          </h2>
          <span className="chart__source">{DETAIL_SOURCE}</span>
        </div>
        {card.href !== null && (
          <ExternalLink href={card.href} nofollow className="validator__cross">
            View toml →<span className="sr">, {card.file}</span>
          </ExternalLink>
        )}
      </div>

      <div className="validator__tomlbody">
        <div className="validator__verified">
          <span className="validator__label">Domain, verified both ways</span>
          <ul className="validator__checks">
            {card.checks.map((check, index) => (
              <li key={index}>
                <span className="validator__tick st--ok">
                  <CheckIcon />
                </span>
                <span className="sr">Passed: </span>
                <span>
                  <Parts parts={check} />
                </span>
              </li>
            ))}
          </ul>
        </div>

        {card.facts === null ? <p className="validator__tomlnote">The data API has not read this toml&apos;s details yet.</p> : <Facts facts={card.facts} />}
      </div>

      {(accounts !== null || currencies !== null) && (
        <div className="validator__tomllists">
          {accounts !== null && (
            <TomlList label="Accounts" section="[[ACCOUNTS]]" lead={accounts.listed} more={accounts.more}>
              {accounts.addresses.map((address) => (
                <AccountLink key={address} net={net} address={address} />
              ))}
            </TomlList>
          )}
          {currencies !== null && (
            <TomlList label="Currencies" section="[[CURRENCIES]]" more={currencies.more}>
              {currencies.items.map((item, index) =>
                item.href === null ? (
                  <span key={index} className="mono validator__code">
                    {item.text}
                  </span>
                ) : (
                  <Link key={index} to={item.href} className="mono validator__code">
                    {item.text}
                  </Link>
                ),
              )}
            </TomlList>
          )}
        </div>
      )}
    </section>
  );
}
