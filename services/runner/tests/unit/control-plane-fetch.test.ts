/** A throttled or restarting control plane is asked again, within an elapsed-time budget (QA3A-1, Codex R4 P1). */
import { describe, expect, it } from "vitest";
import { fetchControlPlane, retryDelayMs } from "../../src/sessions/control-plane-fetch.ts";

const status = (code: number, headers: Record<string, string> = {}) => new Response("x", { status: code, headers });

/** A clock that only moves when the code under test sleeps or a request "takes time". */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => void (t += ms),
    sleep: async (ms: number) => void (t += ms),
  };
}

describe("fetchControlPlane", () => {
  it("waits the Retry-After the platform named, then returns the answer", async () => {
    const answers = [status(429, { "retry-after": "2" }), status(503), status(200)];
    const clock = fakeClock();
    const waits: number[] = [];
    const res = await fetchControlPlane(async () => answers.shift()!, {
      budgetMs: 10_000,
      now: clock.now,
      sleep: async (ms) => (waits.push(ms), clock.sleep(ms)),
      random: () => 0,
    });
    expect(res.status).toBe(200);
    expect(waits[0]).toBe(2_000);
    expect(waits).toHaveLength(2);
  });

  it("returns a non-retryable answer at once", async () => {
    let calls = 0;
    const res = await fetchControlPlane(async () => (calls++, status(409)), { budgetMs: 10_000, sleep: async () => {} });
    expect(res.status).toBe(409);
    expect(calls).toBe(1);
  });

  it("gives up with the last answer when the budget runs out", async () => {
    let calls = 0;
    const clock = fakeClock();
    const res = await fetchControlPlane(async () => (calls++, status(429, { "retry-after": "5" })), {
      budgetMs: 8_000,
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
    });
    expect(res.status).toBe(429);
    expect(calls).toBe(2);
  });

  it("counts the time requests take, not only the waits", async () => {
    let calls = 0;
    const clock = fakeClock();
    const res = await fetchControlPlane(
      async () => {
        calls += 1;
        clock.advance(4_000);
        return status(503);
      },
      { budgetMs: 8_100, now: clock.now, sleep: clock.sleep, random: () => 0 },
    );
    expect(res.status).toBe(503);
    // 4 s + wait + 4 s already spends the budget: a count of waits alone would have allowed more.
    expect(calls).toBe(2);
  });

  it("hands every attempt a signal that fires when the budget is spent", async () => {
    const t0 = Date.now();
    await expect(
      fetchControlPlane(
        (signal) =>
          new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(new Error("attempt cancelled")))),
        { budgetMs: 150 },
      ),
    ).rejects.toThrow(/attempt cancelled/);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("stops waiting when the caller cancels", async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(new Error("stopped")), 50);
    await expect(fetchControlPlane(async () => status(503, { "retry-after": "30" }), { budgetMs: 60_000, signal: stop.signal })).rejects.toThrow(
      /stopped/,
    );
  });

  it("makes one attempt when told to", async () => {
    let calls = 0;
    const res = await fetchControlPlane(async () => (calls++, status(429)), { budgetMs: 10_000, maxAttempts: 1, sleep: async () => {} });
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
  });

  it("reads Retry-After as seconds or as an HTTP date", () => {
    const now = Date.parse("2026-09-24T00:00:00Z");
    expect(retryDelayMs(status(429, { "retry-after": "3" }), 0, () => 0, now)).toBe(3_000);
    expect(retryDelayMs(status(429, { "retry-after": "Thu, 24 Sep 2026 00:00:07 GMT" }), 0, () => 0, now)).toBe(7_000);
  });

  it("backs off with jitter when no Retry-After is given", () => {
    expect(retryDelayMs(status(503), 0, () => 0)).toBe(125);
    expect(retryDelayMs(status(503), 10, () => 1)).toBe(4_000);
  });

  it("gives a call about 30 s by default (flag-safety round)", async () => {
    const clock = fakeClock();
    let calls = 0;
    const res = await fetchControlPlane(async () => (calls++, status(503, { "retry-after": "10" })), { now: clock.now, sleep: clock.sleep, random: () => 0 });
    expect(res.status).toBe(503);
    expect(calls).toBe(3);
  });

  it("returns a transport error at once: an unreachable platform does not hold the turn", async () => {
    let calls = 0;
    await expect(
      fetchControlPlane(async () => {
        calls += 1;
        throw new TypeError("fetch failed");
      }, { sleep: async () => {} }),
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(1);
  });

  it("asks an idempotent write again on any failure, within its attempts", async () => {
    const answers: Array<() => Response> = [
      () => {
        throw new TypeError("fetch failed");
      },
      () => status(500),
      () => status(201),
    ];
    let calls = 0;
    const res = await fetchControlPlane(async () => answers[calls++]!(), { retryFailures: true, maxAttempts: 3, sleep: async () => {} });
    expect(res.status).toBe(201);
    expect(calls).toBe(3);
    calls = 0;
    const last = await fetchControlPlane(async () => (calls++, status(400)), { retryFailures: true, maxAttempts: 3, sleep: async () => {} });
    expect(last.status).toBe(400);
    expect(calls).toBe(3);
  });

  it("does not ask again once the caller cancelled", async () => {
    const stop = new AbortController();
    let calls = 0;
    await expect(
      fetchControlPlane(
        async () => {
          calls += 1;
          stop.abort();
          throw new DOMException("aborted", "AbortError");
        },
        { budgetMs: 10_000, signal: stop.signal, sleep: async () => {} },
      ),
    ).rejects.toThrow(/aborted/);
    expect(calls).toBe(1);
  });
});
