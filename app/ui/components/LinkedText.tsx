import { Link } from "react-router";

/**
 * A sentence a view builder wrote, with the part of it that is a link: "Live from the network at ledger #107,721,455", "Older trades of USD/XRP. The price,
 * chart and order book are on the market's page." The link is the last place `link.text` is in `text`, which is where the builders put it (the end of the
 * sentence, or its last phrase), so that a text that names the same words earlier keeps them as text. A text that does not hold it has the link after it.
 */
export function LinkedText({ text, link, className }: { text: string; link: { text: string; href: string }; className?: string }) {
  const at = text.lastIndexOf(link.text);
  const before = at < 0 ? `${text} ` : text.slice(0, at);
  const after = at < 0 ? "" : text.slice(at + link.text.length);
  return (
    <>
      {before}
      <Link to={link.href} className={className}>
        {link.text}
      </Link>
      {after}
    </>
  );
}
