import { afterEach, describe, expect, it, vi } from "vitest";

import { byDeadline, CARD_DEADLINE_MS, outcome, TooLate } from "./deadline";

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

describe("outcome", () => {
  it("says what a promise came to, as Promise.allSettled does, and never rejects", async () => {
    const error = new Error("no");
    expect(await outcome(Promise.resolve(7))).toEqual({ status: "fulfilled", value: 7 });
    expect(await outcome(Promise.reject(error))).toEqual({ status: "rejected", reason: error });
    const [settled] = await Promise.allSettled([Promise.reject(error)]);
    expect(await outcome(Promise.reject(error))).toEqual(settled);
  });

  it("settles a card that missed its deadline as rejected with the TooLate", async () => {
    const late = await outcome(byDeadline(new Promise(() => {}), Date.now() - 1));
    expect(late.status).toBe("rejected");
    expect((late as PromiseRejectedResult).reason).toBeInstanceOf(TooLate);
  });
});
