import { describe, expect, it } from "vitest";

import { identiconCells, identiconPath } from "./identicon";

const A = "rBbW6idAiqYJzUuk76FYqr347Pbx9oW5jh";
const B = "rHktfGUbjqzU4GsYCMc1pDjdHXb5CJamto";

describe("identiconCells", () => {
  it("is 25 cells, five rows of five", () => {
    expect(identiconCells(A)).toHaveLength(25);
  });

  it("is the same for the same address, every time", () => {
    expect(identiconCells(A)).toEqual(identiconCells(A));
  });

  it("is mirrored left to right, as an avatar is", () => {
    for (const address of [A, B, "rrrrrrrrrrrrrrrrrrrrrhoLvTp", "rGz1sPmwvkaRyZido3CQB3ziVd9dwQ4Y6x"]) {
      const cells = identiconCells(address);
      for (let row = 0; row < 5; row += 1) {
        const line = cells.slice(row * 5, row * 5 + 5);
        expect(line[4], address).toBe(line[0]);
        expect(line[3], address).toBe(line[1]);
      }
    }
  });

  it("differs between addresses (the two fixture accounts, and 200 made-up ones, give many different pictures)", () => {
    expect(identiconCells(A)).not.toEqual(identiconCells(B));
    const alphabet = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
    const pictures = new Set<string>();
    for (let n = 1; n <= 200; n += 1) {
      let seed = n * 7919;
      let address = "r";
      for (let i = 0; i < 30; i += 1) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        address += alphabet[(seed >>> 16) % alphabet.length];
      }
      pictures.add(identiconCells(address).join(""));
    }
    expect(pictures.size).toBeGreaterThan(150);
  });

  it("pins the pictures of the two fixture accounts", () => {
    const text = (address: string) =>
      identiconCells(address)
        .map((on) => (on ? "#" : "."))
        .join("")
        .match(/.{5}/g)!
        .join("/");
    expect(text(A)).toBe("#.#.#/.###./#...#/##.##/..#..");
    expect(text(B)).toBe("##.##/...../..#../..#../#####");
  });
});

describe("identiconPath", () => {
  it("paints exactly the cells that are on, as unit squares in a 5 x 5 box", () => {
    const cells = identiconCells(A);
    const path = identiconPath(cells);
    const painted = new Array<boolean>(25).fill(false);
    for (const match of path.matchAll(/M(\d) (\d)h1v1h-1z/g)) painted[Number(match[2]) * 5 + Number(match[1])] = true;
    expect(painted).toEqual(cells);
  });

  it("is empty for a picture with nothing on", () => {
    expect(identiconPath(new Array<boolean>(25).fill(false))).toBe("");
  });
});
