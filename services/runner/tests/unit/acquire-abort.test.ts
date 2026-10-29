/**
 * A Stop must preempt provider acquisition before the command-delivery timeout. The provider APIs
 * do not accept AbortSignal, so the runner races them and compensates resources that arrive late.
 *
 * Run: pnpm exec vitest run tests/unit/acquire-abort.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { abortableSandboxProvider } from "../../src/environment/abortable-sandbox-provider.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mustSettlePromptly<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error("acquire did not cancel promptly")),
        4_000,
      ),
    ),
  ]);
}

describe("abortableSandboxProvider", () => {
  for (const providerName of ["local", "daytona"] as const) {
    it(`cancels a slow ${providerName} create and deletes the sandbox if it appears late`, async () => {
      const created = deferred<string>();
      const cleaned = deferred<void>();
      const destroyed: string[] = [];
      const controller = new AbortController();
      const provider = abortableSandboxProvider(
        {
          name: providerName,
          create: () => created.promise,
          async destroy(sandboxId: string) {
            destroyed.push(sandboxId);
            cleaned.resolve();
          },
          async getUrl() {
            return "http://sandbox.invalid";
          },
        },
        controller.signal,
        () => {},
      );

      const acquire = provider.create();
      controller.abort();
      await assert.rejects(
        () => mustSettlePromptly(acquire),
        (error: unknown) =>
          error instanceof Error &&
          error.name === "AbortError" &&
          /acquisition was aborted/.test(error.message),
      );

      created.resolve(`${providerName}-late-id`);
      await mustSettlePromptly(cleaned.promise);
      assert.deepEqual(destroyed, [`${providerName}-late-id`]);
    });
  }

  it("parks a Daytona sandbox whose reconnect finishes after cancellation", async () => {
    const reconnected = deferred<void>();
    const cleaned = deferred<void>();
    const controller = new AbortController();
    let paused = 0;
    const provider = abortableSandboxProvider(
      {
        name: "daytona",
        async create() {
          return "unused";
        },
        async destroy() {},
        reconnect: (_sandboxId: string) => reconnected.promise,
        async pause() {
          paused += 1;
          cleaned.resolve();
        },
        async getUrl() {
          return "http://sandbox.invalid";
        },
      },
      controller.signal,
      () => {},
    );

    const acquire = provider.reconnect!("parked-id");
    controller.abort();
    await assert.rejects(() => mustSettlePromptly(acquire), /aborted/);
    reconnected.resolve();
    await mustSettlePromptly(cleaned.promise);
    assert.equal(paused, 1);
  });
});
