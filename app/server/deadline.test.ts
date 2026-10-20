import { afterEach, describe, expect, it, vi } from "vitest";

import { asOutage, byDeadline, CARD_DEADLINE_MS, partOf, TooLate } from "./deadline";
import { UpstreamError } from "./upstream";

afterEach(() => {
  vi.useRealTimers();
});

describe("byDeadline", () => {
  it("gives a card 4.5 s", () => {
    expect(CARD_DEADLINE_MS).toBe(4_500);
  });

  it("rejects with a TooLate that says it took too long, when the time comes", async () => {
    const error = await byDeadline(new Promise(() => {}), Date.now() + 50).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TooLate);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("took too long");
  });

  it("rejects at the absolute time given, and not before", async () => {
    vi.useFakeTimers();
    const outcome = vi.fn();
    byDeadline(new Promise(() => {}), Date.now() + 100).catch(outcome);
    await vi.advanceTimersByTimeAsync(99);
    expect(outcome).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toHaveBeenCalledWith(expect.any(TooLate));
  });

  it("rejects at once for a time that has passed", async () => {
    await expect(byDeadline(new Promise(() => {}), Date.now() - 1_000)).rejects.toBeInstanceOf(TooLate);
  });

  it("lets work that resolves first win, and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(byDeadline(Promise.resolve("done"), Date.now() + CARD_DEADLINE_MS)).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes on the rejection of work that fails first, and clears its timer", async () => {
    vi.useFakeTimers();
    const failure = new Error("upstream said no");
    await expect(byDeadline(Promise.reject(failure), Date.now() + CARD_DEADLINE_MS)).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores work that settles after the deadline", async () => {
    vi.useFakeTimers();
    let finish: (value: string) => void = () => {};
    const late = new Promise<string>((resolve) => (finish = resolve));
    const raced = byDeadline(late, Date.now() + 10);
    const outcome = raced.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toBeInstanceOf(TooLate);
    finish("late");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("partOf", () => {
  const fulfilled = <T,>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
  const rejected = (reason: unknown): PromiseSettledResult<never> => ({ status: "rejected", reason });

  it("is the value of a call that answered", () => {
    expect(partOf(fulfilled({ quorum: 28 }))).toEqual({ state: "ok", value: { quorum: 28 } });
  });

  it("is a failed card for a call past its deadline, as for an upstream that failed", () => {
    expect(partOf(rejected(new TooLate()))).toEqual({ state: "failed" });
    expect(partOf(rejected(new UpstreamError("server", "data API GET /v2/x answered 503", { status: 503 })))).toEqual({ state: "failed" });
  });

  it("is missing for an upstream's not-found, as `loaded` says", () => {
    expect(partOf(rejected(new UpstreamError("not_found", "data API GET /v2/x answered 404", { status: 404 })))).toEqual({ state: "missing" });
  });

  it("throws again what is neither: a bug is not a card that failed", () => {
    const bug = new TypeError("x is undefined");
    expect(() => partOf(rejected(bug))).toThrow(bug);
  });
});

describe("asOutage", () => {
  it("makes a call past its deadline an upstream timeout, which upstreamOutage answers with a 503", () => {
    const late = new TooLate();
    const outage = asOutage(late);
    expect(outage).toBeInstanceOf(UpstreamError);
    expect(outage).toMatchObject({ kind: "timeout", message: "took too long", cause: late });
  });

  it("passes on every other reason as it is", () => {
    const upstream = new UpstreamError("server", "data API GET /v2/x answered 503", { status: 503 });
    const bug = new TypeError("x is undefined");
    expect(asOutage(upstream)).toBe(upstream);
    expect(asOutage(bug)).toBe(bug);
  });
});
