import { Link } from "react-router";

import type { NetworkId } from "../../server/networks";
import { NETWORK_CHOICES } from "../networks";

/**
 * The two networks as a segmented control. They are links to each network's home (switching goes to the other network's
 * home, never to the same page there, spec 2); the current one is marked with `aria-current`.
 */
export function NetworkSwitch({ net }: { net: NetworkId }) {
  return (
    <div role="group" aria-label="Network" className="netswitch">
      {NETWORK_CHOICES.map((choice) => (
        <Link
          key={choice.id}
          to={`/${choice.id}`}
          className="netswitch__item"
          aria-current={choice.id === net ? "true" : undefined}
        >
          <span className="netswitch__dot" data-network={choice.id} />
          {choice.name}
        </Link>
      ))}
    </div>
  );
}
