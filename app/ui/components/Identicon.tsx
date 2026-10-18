import { identiconCells, identiconPath } from "../../domain/identicon";

/**
 * The picture beside an address: a 5 x 5 pattern drawn from the address alone (`identiconCells`), in the network's accent. It is
 * decoration, a mark to recognise an account by at a glance, so it is hidden from screen readers; the address is next to it.
 */
export function Identicon({ address }: { address: string }) {
  return (
    <svg className="identicon" viewBox="0 0 5 5" aria-hidden="true" focusable="false">
      <path d={identiconPath(identiconCells(address))} />
    </svg>
  );
}
