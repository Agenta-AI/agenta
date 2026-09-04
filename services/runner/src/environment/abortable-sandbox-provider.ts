import type { SandboxProvider } from "sandbox-agent";

import { waitForAcquire } from "./acquire-abort.ts";

type ProviderMethod = (...args: any[]) => Promise<any>;

async function cleanupCreatedSandbox(
  provider: SandboxProvider,
  sandboxId: string,
  log: (message: string) => void,
): Promise<void> {
  try {
    await provider.destroy(sandboxId);
    log(`cancelled acquire cleaned late-created sandbox=${sandboxId}`);
  } catch (error) {
    log(
      `cancelled acquire cleanup failed sandbox=${sandboxId}: ${String(
        error instanceof Error ? error.message : error,
      ).slice(0, 160)}`,
    );
  }
}

async function cleanupReconnectedSandbox(
  provider: SandboxProvider,
  sandboxId: string,
  log: (message: string) => void,
): Promise<void> {
  try {
    if (provider.pause) await provider.pause(sandboxId);
    else await provider.destroy(sandboxId);
    log(`cancelled acquire cleaned late-reconnected sandbox=${sandboxId}`);
  } catch (error) {
    log(
      `cancelled reconnect cleanup failed sandbox=${sandboxId}: ${String(
        error instanceof Error ? error.message : error,
      ).slice(0, 160)}`,
    );
  }
}

/**
 * Make the provider-owned part of `SandboxAgent.start` observe the turn signal.
 *
 * `sandbox-agent` forwards its signal only to the client health wait; provider `create()` and
 * `reconnect()` have no signal parameter. This proxy races those calls without changing provider
 * identity or hiding provider-specific methods. A fresh sandbox that appears after cancellation
 * is deleted; a late reconnect is returned to its parked state when the provider supports pause.
 */
export function abortableSandboxProvider<T extends SandboxProvider>(
  provider: T,
  signal: AbortSignal | undefined,
  log: (message: string) => void,
): T {
  if (!signal) return provider;

  return new Proxy(provider, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      if (property === "create") {
        return (...args: unknown[]) =>
          waitForAcquire(
            () => Reflect.apply(value as ProviderMethod, target, args),
            signal,
            {
              onLateSuccess: (sandboxId: string) =>
                cleanupCreatedSandbox(target, sandboxId, log),
            },
          );
      }

      if (property === "reconnect") {
        return (sandboxId: string, ...args: unknown[]) =>
          waitForAcquire(
            () =>
              Reflect.apply(value as ProviderMethod, target, [
                sandboxId,
                ...args,
              ]),
            signal,
            {
              onLateSuccess: () =>
                cleanupReconnectedSandbox(target, sandboxId, log),
              onLateFailure: () =>
                cleanupReconnectedSandbox(target, sandboxId, log),
            },
          );
      }

      // These calls happen after a raw sandbox id exists. `SandboxAgent.start` owns compensation
      // if one is cancelled, so they need only become promptly abortable here.
      if (
        property === "ensureServer" ||
        property === "getUrl" ||
        property === "getFetch"
      ) {
        return (...args: unknown[]) =>
          waitForAcquire(
            () => Reflect.apply(value as ProviderMethod, target, args),
            signal,
          );
      }

      return value.bind(target);
    },
  });
}
