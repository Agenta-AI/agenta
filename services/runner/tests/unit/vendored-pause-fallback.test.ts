/**
 * Pins the vendored `sandbox-agent` package's `pauseSandbox()` fallback semantics against the
 * REAL dist code (not a re-implementation), so an upstream bump of the `sandbox-agent` package
 * cannot silently change this behavior out from under `engines/sandbox_agent.ts`'s destroy
 * closure and its delete fallback.
 *
 * Two facts this pins:
 *  - A provider with no `pause` hook makes `pauseSandbox()` call `provider.destroy()` instead.
 *  - A failed pause retains the provider handles so a delete fallback can run.
 *
 * The pause tests construct a minimal instance via `Object.create(SandboxAgent.prototype)` so
 * `pauseSandbox()` (and the `dispose()` it calls internally) run as the actual shipped methods,
 * against hand-built instance state that mirrors what `SandboxAgent.start()` would have set.
 *
 * Run: pnpm exec vitest run tests/unit/vendored-pause-fallback.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { SandboxAgent } from "sandbox-agent";

interface StubSandboxProvider {
  name: string;
  create: () => Promise<string>;
  destroy: (rawId: string) => Promise<void>;
  getUrl: (rawId: string) => Promise<string>;
  ensureServer: (rawId: string) => Promise<void>;
  pause?: (rawId: string) => Promise<void>;
}

describe("vendored sandbox-agent reconnect cleanup (real dist code)", () => {
  it("pauses a reconnected sandbox when later attachment setup fails", async () => {
    const calls: string[] = [];
    const provider: StubSandboxProvider & { reconnect: (rawId: string) => Promise<void> } = {
      name: "stub",
      create: async () => "unused",
      destroy: async () => { calls.push("destroy"); },
      reconnect: async () => { calls.push("reconnect"); },
      pause: async () => { calls.push("pause"); },
      ensureServer: async () => { throw new Error("server setup failed"); },
      getUrl: async () => "http://stub.local",
    };

    await assert.rejects(
      () => SandboxAgent.start({ sandbox: provider, sandboxId: "stub/raw-1" }),
      /server setup failed/,
    );

    assert.deepEqual(calls, ["reconnect", "pause"]);
  });
});

/**
 * `SandboxAgent`'s instance fields (`sandboxProvider` et al.) are declared `private` in its
 * TypeScript types, so a structurally-compatible object intersected with `InstanceType<typeof
 * SandboxAgent>` collapses to `never` under `--strict`. The real prototype chain (and therefore
 * the real `pauseSandbox`/`dispose` methods) only exists at runtime, which `any` reflects
 * honestly here: this helper deliberately reaches past the public type to drive the actual
 * vendored implementation, not a copy of its declared shape.
 */
function buildFakeInstance(provider: StubSandboxProvider, rawId: string): any {
  // Real prototype chain so `pauseSandbox()` and the `dispose()` it calls in its `finally` are
  // the actual vendored methods, not stand-ins. Only the instance fields those two methods touch
  // need to exist: the provider handles, the disposed flag, and the empty collections `dispose()`
  // iterates.
  const instance = Object.create(SandboxAgent.prototype);
  Object.assign(instance, {
    sandboxProvider: provider,
    sandboxProviderId: `${provider.name}/${rawId}`,
    sandboxProviderRawId: rawId,
    disposed: false,
    healthWaitAbortController: new AbortController(),
    pendingPermissionRequests: new Map(),
    liveConnections: new Map(),
    pendingLiveConnections: new Map(),
    pendingObservedEnvelopePersistenceBySession: new Map(),
  });
  return instance;
}

describe("vendored sandbox-agent pauseSandbox fallback (real dist code)", () => {
  it("calls the provider's destroy() when the provider has no pause hook", async () => {
    const destroyed: string[] = [];
    const provider: StubSandboxProvider = {
      name: "stub",
      create: async () => "raw-1",
      destroy: async (rawId) => {
        destroyed.push(rawId);
      },
      getUrl: async () => "http://stub.local",
      ensureServer: async () => {},
    };
    const instance = buildFakeInstance(provider, "raw-1");

    await instance.pauseSandbox();

    assert.deepEqual(
      destroyed,
      ["raw-1"],
      "a provider without pause() falls back to destroy() inside the real pauseSandbox()",
    );
  });

  it("clears sandboxProvider/sandboxProviderRawId after pausing, even via the destroy fallback", async () => {
    const provider: StubSandboxProvider = {
      name: "stub",
      create: async () => "raw-1",
      destroy: async () => {},
      getUrl: async () => "http://stub.local",
      ensureServer: async () => {},
    };
    const instance = buildFakeInstance(provider, "raw-1");

    await instance.pauseSandbox();

    assert.equal(
      instance.sandboxProvider,
      undefined,
      "the real pauseSandbox()'s finally clears the provider handle",
    );
    assert.equal(instance.sandboxProviderRawId, undefined);
  });

  it("retains the provider handles when the underlying pause throws", async () => {
    let destroys = 0;
    const provider: StubSandboxProvider = {
      name: "stub",
      create: async () => "raw-1",
      destroy: async () => { destroys += 1; },
      pause: async () => {
        throw new Error("provider pause failed");
      },
      getUrl: async () => "http://stub.local",
      ensureServer: async () => {},
    };
    const instance = buildFakeInstance(provider, "raw-1");

    await assert.rejects(() => instance.pauseSandbox(), /provider pause failed/);

    assert.equal(instance.sandboxProvider, provider);
    assert.equal(instance.sandboxProviderRawId, "raw-1");

    await instance.destroySandbox();
    assert.equal(destroys, 1);
    assert.equal(instance.sandboxProvider, undefined);
    assert.equal(instance.sandboxProviderRawId, undefined);
  });
});
