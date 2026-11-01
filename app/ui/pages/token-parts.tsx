// The small parts the token pages share (E11 spec 8): the mark of the issuer's toml listing a token. The list's table draws it now; the token page's header will. Browser code: it imports
// nothing of the Worker (test/unit/token-bundle.test.ts).

import { CheckCircleIcon } from "../components/status-icons";

/**
 * Whether the issuer's toml lists a token: an icon and "listed", the rest of the words ("in the issuer's toml") for a screen reader only; or a dash with "not listed in the issuer's
 * toml" the same way. The status is told by the icon and the words, never by a colour alone (spec 7.3); the icon is decoration.
 */
export function ListedMark({ listed }: { listed: boolean }) {
  if (!listed) {
    return (
      <span className="faint">
        —<span className="sr">not listed in the issuer's toml</span>
      </span>
    );
  }
  return (
    <span className="st st--ok">
      <CheckCircleIcon />
      listed<span className="sr"> in the issuer's toml</span>
    </span>
  );
}
