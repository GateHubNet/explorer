// The data of a client-side navigation (`<path>.data`) as the plain value it was made of, for the specs that read what the Worker hands the browser. Pure (no Worker import), so that a
// Node test can check the decoder itself.
//
// The body is a flat list (React Router's vendored turbo-stream v2, `unflatten`): the root is element 0; an object is `{ "_<i>": <v> }`, its key the string at element `i` and its value
// element `v`; an array is a list of element indexes; a string, number or boolean element is itself. Negative indexes stand for the values that are not in the list. What this does not
// decode (a Date, a Map, a Promise, an error, any array that starts with a type tag; a special value it does not know; an index that points outside the list) it throws on, rather
// than hand a spec a value that only looks right.

/** The special values the stream writes as a negative index (`hydrate`'s switch in react-router's turbo-stream-v2/unflatten.js). */
const SPECIAL: ReadonlyMap<number, unknown> = new Map<number, unknown>([
  [-7, undefined],
  [-5, null],
  [-2, Number.NaN],
  [-6, Number.POSITIVE_INFINITY],
  [-3, Number.NEGATIVE_INFINITY],
  [-4, -0],
]);

/** A hole in an array: the element is not set. */
const HOLE = -1;

export function decodeLoaderData(body: string): unknown {
  const flat = JSON.parse(body) as unknown[];
  const made = new Map<number, unknown>();

  const at = (index: unknown): unknown => {
    if (typeof index !== "number" || !Number.isInteger(index)) throw new SyntaxError(`turbo-stream: ${JSON.stringify(index)} is not an index`);
    if (index < 0) {
      if (!SPECIAL.has(index)) throw new SyntaxError(`turbo-stream: the special value ${index} is not decoded`);
      return SPECIAL.get(index);
    }
    if (index >= flat.length) throw new SyntaxError(`turbo-stream: element ${index} is not in the list of ${flat.length}`);
    if (made.has(index)) return made.get(index);

    const item = flat[index];
    if (Array.isArray(item)) {
      if (typeof item[0] === "string") throw new SyntaxError(`turbo-stream: the array "${item[0]}" at element ${index} is not decoded`);
      const items: unknown[] = [];
      made.set(index, items);
      item.forEach((element, position) => {
        if (element !== HOLE) items[position] = at(element);
      });
      return items;
    }
    if (typeof item === "object" && item !== null) {
      const object: Record<string, unknown> = {};
      made.set(index, object);
      for (const [key, value] of Object.entries(item)) {
        if (!/^_\d+$/.test(key)) throw new SyntaxError(`turbo-stream: ${JSON.stringify(key)} at element ${index} is not a key`);
        const name = at(Number(key.slice(1)));
        if (typeof name !== "string") throw new SyntaxError(`turbo-stream: the key ${key} at element ${index} is not a string`);
        object[name] = at(value);
      }
      return object;
    }
    return item;
  };

  return at(0);
}
