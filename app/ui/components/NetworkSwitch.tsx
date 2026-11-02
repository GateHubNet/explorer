import { Link } from "react-router";

import type { NetworkId } from "../../server/networks";
import { networkKindOf } from "../environment";
import { networkChoices } from "../networks";
import { useEnvironment } from "../use-network";

/**
 * The two networks as a segmented control. They are links to each network's home (switching goes to the other network's
 * home, never to the same page there, spec 2); the current one is marked with `aria-current`. The names are the environment's
 * (`useEnvironment()`): the switch is drawn where there is no `/:net` data to read them from (the unknown network's error page).
 */
export function NetworkSwitch({ net }: { net: NetworkId }) {
  const choices = networkChoices(networkKindOf(useEnvironment()));
  return (
    <div role="group" aria-label="Network" className="netswitch">
      {choices.map((choice) => (
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
