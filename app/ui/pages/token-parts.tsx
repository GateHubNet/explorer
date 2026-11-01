// The small parts the token pages share (E11 spec 8): the mark of the issuer's toml listing a token (the list's table), and a row of the issuer's settings (the token page's card). Browser
// code: it imports nothing of the Worker (test/unit/token-bundle.test.ts).

import type { SettingRowView } from "../../server/token-view";
import { Pill } from "../components/Pill";
import { CheckCircleIcon, MinusCircleIcon } from "../components/status-icons";

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

/**
 * A setting of the issuer's account (spec 3.1): an icon (a check when the setting is in effect, a minus when it is not; a picture), the name with its pill, which says it in a word
 * ("None", "On", "Not set", "Allowed"), and the sentence of what it means for the token. The status is the icon and the word, never a colour alone. A list item: the card makes the list.
 */
export function SettingRow({ row }: { row: SettingRowView }) {
  return (
    <li className="token-setting">
      <span className="token-setting__icon" aria-hidden="true">
        {row.on ? <CheckCircleIcon size={18} /> : <MinusCircleIcon size={18} />}
      </span>
      <span className="token-setting__body">
        <span className="token-setting__head">
          <span>{row.name}</span>
          <Pill>{row.value}</Pill>
        </span>
        <span className="token-setting__sentence">{row.sentence}</span>
      </span>
    </li>
  );
}
