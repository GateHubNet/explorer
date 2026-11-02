// A degraded mark that records every reason it is given, for the tests that read what a load marked (`createLoadContext`'s third argument). Types only from the app:
// Node and the Workers runtime alike.

import type { DegradedMark } from "../../app/server/edge-cache";

/** A degraded mark, and every reason it was given in order (the Worker's own keeps the first; the reasons a test reads are all of them). */
export function recordingMark(): { mark: DegradedMark; marks: string[] } {
  const marks: string[] = [];
  const mark: DegradedMark = {
    get degraded() {
      return marks.length > 0;
    },
    get reason() {
      return marks[0];
    },
    mark: (reason) => void marks.push(reason),
  };
  return { mark, marks };
}
