// The account page's name header (E9, spec 6.1 to 6.4; the board AccountNames.dc.html): the picture, "Account", the `<h1>` with how its name is known, the address with its
// buttons, and what is said under it by kind: a verified name's domain and "How we know", the help under a name GateHub gave, the sentence of a domain that is not verified. The
// label banners are here too, drawn by the page above the header. Draws what `accountNameHeader` made (a type only: the builder is the Worker's); nothing here decides what is
// true of a name.

import { Fragment } from "react";
import { Link } from "react-router";

import type { DomainLine, DomainState, HowWeKnow as HowWeKnowFacts, LabelBanner, NameHeader, NameTitle, TomlFacts } from "../../server/account-name-view";
import type { QrPicture } from "../../server/account-view";
import type { NetworkId } from "../../server/networks";
import { NAME_REQUEST_URL } from "../brand";
import { CopyButton } from "./CopyButton";
import { DomainStatus } from "./DomainStatus";
import { ExternalLink } from "./ExternalLink";
import { Identicon } from "./Identicon";
import { CheckIcon, ChevronRightIcon } from "./icons";
import { LabelMark, NameMark } from "./NameMark";
import { Notice } from "./Notice";
import { QrButton } from "./QrButton";

/** What the page and its breadcrumb call the account: the name, then ` · ` and the account network name when it has one that is not the name itself (as `linkTextOf` writes it). */
export const titleTextOf = (title: NameTitle): string => (title.network ? `${title.text} · ${title.network}` : title.text);

/** How `DomainStatus` calls a domain's state: `none` has no mark. */
const STATUS = { verified: "verified", "not-verified": "unverified", pending: "pending" } as const satisfies Record<Exclude<DomainState, "none">, string>;

/** The domain on a line of the page, with the mark of its state (none for a text that is no domain); the mark's title is the sentence of what the toml said. */
export function DomainText({ line }: { line: DomainLine }) {
  return (
    <>
      domain <span className="mono">{line.text}</span>
      {line.state !== "none" && (
        <>
          {" "}
          <DomainStatus status={STATUS[line.state]} title={line.state === "not-verified" ? line.note : undefined} />
        </>
      )}
    </>
  );
}

/**
 * The header's top: the picture, "Account", the title, and the address with its copy and QR buttons. With a name the name is the `<h1>` (its link text, then the marks, each after
 * a space so that the heading reads "Northpeak Treasury verified name") and the address is the line under it; without, the address is the `<h1>` as it has always been, with the
 * label's mark when it has labels. The lines of what is known follow (`NameLines`). `net` is the network of the page. The currencies of the toml's facts are links to their token pages
 * where the builder gave them one (`href`: `TOKENS` on, an issuer, a code the token page reads), else text.
 */
export function AccountNameBlock({ address, qr, name }: { net: NetworkId; address: string; qr: QrPicture; name: NameHeader | null }) {
  const title = name?.title ?? null;
  const labels = name?.labelMarks ?? [];
  return (
    <>
      <div className="account-id__top">
        <Identicon address={address} />
        <div className="account-id__name">
          <span className="account-id__label">Account</span>
          {title ? (
            <>
              <h1 className="account-head__name">
                {titleTextOf(title)} <NameMark kind={title.kind} />
                {labels.length > 0 && (
                  <>
                    {" "}
                    <LabelMark labels={labels} />
                  </>
                )}
              </h1>
              <div className="account-id__address">
                <span className="account-head__address mono">{address}</span>
                <CopyButton value={address} label="address" />
                <QrButton address={address} qr={qr} />
              </div>
            </>
          ) : (
            <div className="account-id__address">
              <h1 className="mono">
                {address}
                {labels.length > 0 && (
                  <>
                    {" "}
                    <LabelMark labels={labels} />
                  </>
                )}
              </h1>
              <CopyButton value={address} label="address" />
              <QrButton address={address} qr={qr} />
            </div>
          )}
        </div>
      </div>
      {name && <NameLines name={name} />}
    </>
  );
}

/**
 * What is said under the title, by how the name is known (6.1). A header of a page behind a marker is the title and the labels only, so its lines are none: the builder leaves out
 * the domain line, "How we know" and the help, and each kind draws its line only when it has what it says.
 */
function NameLines({ name }: { name: NameHeader }) {
  const { title, domainLine } = name;
  switch (title?.kind) {
    case "verified":
      return (
        <>
          {domainLine && (
            <p className="account-head__kind">
              Verified name ·{" "}
              {domainLine.state === "verified" && domainLine.href !== undefined ? (
                <>
                  domain{" "}
                  <ExternalLink href={domainLine.href} nofollow>
                    {domainLine.text}
                  </ExternalLink>
                </>
              ) : (
                <DomainText line={domainLine} />
              )}
            </p>
          )}
          {name.howWeKnow && <HowWeKnow how={name.howWeKnow} facts={name.facts} />}
        </>
      );
    case "account":
      if (name.help === null) return null;
      return (
        <>
          <p className="account-head__kind">Named by GateHub · {domainLine ? <DomainText line={domainLine} /> : "no domain set"}</p>
          {/* What the toml said of the domain, as text and not only the mark's title (6.3): for the check that found something, not for "not checked yet", whose words are the mark's. */}
          {domainLine?.state === "not-verified" && domainLine.note && <p className="account-head__kind">{domainLine.note}</p>}
          <p className="account-head__kind account-head__help">
            GateHub names accounts that have no verified name, such as an exchange&apos;s hot wallet. If this name is wrong, or an account you run should have one,{" "}
            {NAME_REQUEST_URL === null ? (
              "ask GateHub to change it"
            ) : (
              <ExternalLink href={NAME_REQUEST_URL} nofollow>
                ask GateHub to change it
              </ExternalLink>
            )}
            .
          </p>
        </>
      );
    case "domain":
      return domainLine?.note ? <p className="account-head__kind">{domainLine.note}</p> : null;
    default:
      return null;
  }
}

/**
 * "How we know" (6.2): a native disclosure, closed, so that a keyboard and a screen reader operate it with no script and a reader without script can open it. Two checks that
 * passed, each with a tick and the words "Passed: " for a screen reader, when the toml was checked, and what else the toml says (the facts), each row only when present.
 */
function HowWeKnow({ how, facts }: { how: HowWeKnowFacts; facts: TomlFacts | null }) {
  return (
    <details className="disc">
      <summary>
        How we know
        <ChevronRightIcon className="disc__chevron" />
      </summary>
      <ul className="disc__checks">
        <li>
          <CheckIcon size={14} />
          <span>
            <span className="sr">Passed: </span>
            The account&apos;s Domain field is <strong>{how.domain}</strong>.
          </span>
        </li>
        <li>
          <CheckIcon size={14} />
          <span>
            <span className="sr">Passed: </span>
            <ExternalLink href={how.tomlHref} nofollow>
              <span className="mono">{how.tomlText}</span>
            </ExternalLink>{" "}
            lists this address under <span className="mono">[[ACCOUNTS]]</span>
            {how.descGivesName ? (
              <>
                , and its <span className="mono">desc</span> gives the name.
              </>
            ) : (
              <>
                . It gives no <span className="mono">desc</span>, so the name is the domain.
              </>
            )}
          </span>
        </li>
      </ul>
      {how.checked && <p className="disc__checked faint">Checked {how.checked}</p>}
      {facts && (
        <div className="disc__box">
          <strong>What else that toml says</strong>
          <dl className="toml-facts">
            {facts.principals && (
              <div>
                <dt>Principals</dt>
                <dd>{facts.principals}</dd>
              </div>
            )}
            {facts.currencies && (
              <div>
                <dt>Currencies</dt>
                <dd>
                  {facts.currencies.map((currency, at) => (
                    <Fragment key={at}>
                      {at > 0 && " "}
                      {currency.href === null ? (
                        <span className="mono">{currency.code}</span>
                      ) : (
                        <Link to={currency.href} className="mono tokenlink">
                          {currency.code}
                        </Link>
                      )}
                    </Fragment>
                  ))}
                </dd>
              </div>
            )}
            {facts.modified && (
              <div>
                <dt>Last modified</dt>
                <dd>
                  <span className="num">{facts.modified}</span>{" "}
                  <span>
                    from <span className="mono">[METADATA]</span>
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </details>
  );
}

/**
 * The warning banners above the header (6.4): one for each label GateHub gave the account, in the API's order, a deleted account's too. Its title, the operator's description,
 * "Source: …" when it gave one, and "Details" when it gave an `https:` link (the builder leaves any other out). A banner is a notice, not a heading: the page's headings are
 * as they were.
 */
export function LabelBanners({ labels }: { labels: readonly LabelBanner[] }) {
  return (
    <>
      {labels.map((banner) => (
        <Notice key={banner.label} tone="warning" title={banner.title}>
          {banner.description}
          {(banner.source !== undefined || banner.href !== undefined) && (
            <span className="label-banner__meta">
              {banner.source !== undefined && <span>Source: {banner.source}</span>}
              {banner.href !== undefined && (
                <ExternalLink href={banner.href} nofollow>
                  Details
                </ExternalLink>
              )}
            </span>
          )}
        </Notice>
      ))}
    </>
  );
}
