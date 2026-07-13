import { DaytonaNotFoundError } from "@daytonaio/sdk";

import type { McpServerConfig } from "../../protocol.ts";
import { DaytonaReconnectTerminalError } from "./daytona-provider.ts";
import type { DaytonaSecretPlan } from "./daytona-secret-plan.ts";
import {
  allocateDaytonaSecrets,
  deleteDaytonaSecrets,
  type DaytonaSecretAllocation,
  type DaytonaSecretApi,
} from "./daytona-secrets.ts";

export interface DaytonaProviderLike {
  name: string;
  create(...args: unknown[]): Promise<string>;
  destroy(sandboxId: string): Promise<void>;
  reconnect?(sandboxId: string): Promise<void>;
  pause?(sandboxId: string): Promise<void>;
}

interface RegistryEntry {
  allocation: DaytonaSecretAllocation;
  plan: DaytonaSecretPlan;
  createFingerprint: string;
  generation: number;
  operation: Promise<void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

export interface ProcessLocalDaytonaSecretProvider extends DaytonaProviderLike {
  materializeMcpServers(
    servers: McpServerConfig[] | undefined,
  ): McpServerConfig[] | undefined;
}

export interface ProcessLocalSecretDependencies {
  registry?: Map<string, RegistryEntry>;
  /** Hash of all create-time routing, environment, and sandbox config. */
  createFingerprint?: string;
  cleanupDelayMilliseconds: number;
  setCleanupTimer?: typeof setTimeout;
  clearCleanupTimer?: typeof clearTimeout;
  log?: (message: string) => void;
}

const processLocalRegistry = new Map<string, RegistryEntry>();

function plansMatch(entry: RegistryEntry, createFingerprint: string): boolean {
  return entry.createFingerprint === createFingerprint;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof DaytonaNotFoundError ||
    (typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404)
  );
}

async function destroySandboxIdempotently(
  provider: DaytonaProviderLike,
  sandboxId: string,
): Promise<void> {
  try {
    await provider.destroy(sandboxId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** Serialize lifecycle side effects for one sandbox allocation without poisoning later calls. */
function serialize<T>(
  entry: RegistryEntry,
  operation: () => Promise<T>,
): Promise<T> {
  const result = entry.operation.catch(() => {}).then(operation);
  entry.operation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function withMcpPlaceholders(
  servers: McpServerConfig[] | undefined,
  allocation: DaytonaSecretAllocation | undefined,
): McpServerConfig[] | undefined {
  if (!allocation || !servers) return servers;
  return servers.map((server) => {
    const placeholders = allocation.mcpHeaderPlaceholders[server.name];
    if (
      Object.keys(server.headers ?? {}).length === 0 &&
      (server.credentials?.length ?? 0) === 0
    ) {
      return server;
    }
    if (!placeholders) {
      throw new Error(
        `Daytona Secret allocation is missing MCP placeholders for '${server.name}'.`,
      );
    }
    return {
      ...server,
      headers: server.headers
        ? Object.fromEntries(
            Object.keys(server.headers).map((name) => {
              const placeholder = placeholders[name];
              if (!placeholder) {
                throw new Error(
                  `Daytona Secret allocation is missing MCP placeholder '${name}'.`,
                );
              }
              return [name, placeholder];
            }),
          )
        : undefined,
      credentials: server.credentials?.map((credential) => {
        const placeholder = placeholders[credential.binding.name];
        if (!placeholder) {
          throw new Error(
            `Daytona Secret allocation is missing MCP placeholder '${credential.binding.name}'.`,
          );
        }
        return { ...credential, value: placeholder };
      }),
    };
  });
}

/**
 * Wrap Daytona provisioning with process-local Secret allocation.
 *
 * A parked sandbox and its allocation live in the registry together. This deliberately cannot
 * survive a runner crash. Durable reconciliation is PR B.
 */
export function daytonaWithProcessLocalSecrets<T extends DaytonaProviderLike>(
  buildProvider: (attachments: Record<string, string>) => T,
  plan: DaytonaSecretPlan,
  api: DaytonaSecretApi,
  dependencies: ProcessLocalSecretDependencies,
): T & ProcessLocalDaytonaSecretProvider {
  const registry = dependencies.registry ?? processLocalRegistry;
  const schedule = dependencies.setCleanupTimer ?? setTimeout;
  const cancel = dependencies.clearCleanupTimer ?? clearTimeout;
  const log = dependencies.log ?? (() => {});
  const createFingerprint =
    dependencies.createFingerprint ?? JSON.stringify(plan);
  let provider: T | undefined;
  let currentAllocation: DaytonaSecretAllocation | undefined;

  const providerFor = (attachments: Record<string, string>): T => {
    provider ??= buildProvider(attachments);
    return provider;
  };

  const cleanupAfterSandbox = async (
    sandboxId: string,
    entry: RegistryEntry,
    activeProvider: T,
  ): Promise<void> => {
    // A Secret remains mounted until Daytona confirms the sandbox is absent. Never reverse this
    // order, including timer cleanup and create compensation after an id was returned.
    await destroySandboxIdempotently(activeProvider, sandboxId);
    await deleteDaytonaSecrets(entry.allocation, api);
    if (registry.get(sandboxId) === entry) registry.delete(sandboxId);
    if (currentAllocation === entry.allocation) currentAllocation = undefined;
  };

  const facade: ProcessLocalDaytonaSecretProvider = {
    name: "daytona",
    async create(...args: unknown[]): Promise<string> {
      const allocation = await allocateDaytonaSecrets(plan, api);
      try {
        provider = buildProvider(allocation.attachments);
      } catch (cause) {
        // buildProvider is synchronous and failed before any remote create call, so absence is
        // proven and compensation may safely remove the newly allocated Secrets.
        try {
          await deleteDaytonaSecrets(allocation, api);
        } catch (cleanupError) {
          throw new AggregateError(
            [cause, cleanupError],
            "Daytona provider construction failed and Secret cleanup was incomplete.",
          );
        }
        throw cause;
      }
      try {
        const sandboxId = await provider.create(...args);
        const entry: RegistryEntry = {
          allocation,
          plan,
          createFingerprint,
          generation: 0,
          operation: Promise.resolve(),
        };
        registry.set(sandboxId, entry);
        currentAllocation = allocation;
        return sandboxId;
      } catch (cause) {
        // The vendored provider creates the remote sandbox before it starts the daemon and only
        // returns the id after both succeed. A rejection therefore cannot prove remote absence.
        // Retain Secrets rather than deleting records that a partially-created sandbox may mount.
        if (allocation.created.length > 0) {
          log(
            "Daytona create failed before remote absence could be confirmed; retaining " +
              `${allocation.created.length} Secret allocation(s) for safety.`,
          );
        }
        throw cause;
      }
    },
    async reconnect(sandboxId: string): Promise<void> {
      const entry = registry.get(sandboxId);
      const activeProvider = providerFor({});
      if (!entry) {
        // The runner restarted or lost ownership. It cannot prove which Secrets back the parked
        // sandbox, so delete the sandbox and force the caller onto a fresh create.
        await destroySandboxIdempotently(activeProvider, sandboxId);
        throw new DaytonaReconnectTerminalError(
          sandboxId,
          "missing-process-local-secret-allocation",
        );
      }
      if (entry.cleanupTimer) {
        cancel(entry.cleanupTimer);
        entry.cleanupTimer = undefined;
      }
      // Invalidate a timer callback that fired but has not entered its serialized operation yet.
      // If cleanup already owns the operation, reconnect waits and observes the deleted entry.
      entry.generation += 1;
      await serialize(entry, async () => {
        if (registry.get(sandboxId) !== entry) {
          throw new DaytonaReconnectTerminalError(
            sandboxId,
            "missing-process-local-secret-allocation",
          );
        }
        if (!plansMatch(entry, createFingerprint)) {
          await cleanupAfterSandbox(sandboxId, entry, activeProvider);
          throw new DaytonaReconnectTerminalError(
            sandboxId,
            "process-local-secret-allocation-mismatch",
          );
        }
        currentAllocation = entry.allocation;
        try {
          await activeProvider.reconnect?.(sandboxId);
        } catch (cause) {
          try {
            await cleanupAfterSandbox(sandboxId, entry, activeProvider);
          } catch (cleanupError) {
            throw new AggregateError(
              [cause, cleanupError],
              "Daytona reconnect failed and process-local cleanup was incomplete.",
            );
          }
          throw cause;
        }
      });
    },
    async pause(sandboxId: string): Promise<void> {
      const activeProvider = providerFor({});
      const entry = registry.get(sandboxId);
      if (!entry) {
        await activeProvider.pause?.(sandboxId);
        return;
      }
      if (entry.cleanupTimer) cancel(entry.cleanupTimer);
      entry.cleanupTimer = undefined;
      entry.generation += 1;
      await serialize(entry, async () => {
        if (registry.get(sandboxId) !== entry) return;
        await activeProvider.pause?.(sandboxId);
        const scheduledGeneration = entry.generation;
        entry.cleanupTimer = schedule(() => {
          void serialize(entry, async () => {
            if (
              registry.get(sandboxId) !== entry ||
              entry.generation !== scheduledGeneration
            ) {
              return;
            }
            entry.cleanupTimer = undefined;
            await cleanupAfterSandbox(sandboxId, entry, activeProvider);
          }).catch((error) => {
            log(
              `process-local Daytona Secret cleanup failed sandbox=${sandboxId}: ${String(
                error instanceof Error ? error.message : error,
              ).slice(0, 200)}`,
            );
          });
        }, dependencies.cleanupDelayMilliseconds);
        entry.cleanupTimer.unref?.();
      });
    },
    async destroy(sandboxId: string): Promise<void> {
      const activeProvider = providerFor({});
      const entry = registry.get(sandboxId);
      if (!entry) {
        await destroySandboxIdempotently(activeProvider, sandboxId);
        return;
      }
      if (entry.cleanupTimer) {
        cancel(entry.cleanupTimer);
        entry.cleanupTimer = undefined;
      }
      entry.generation += 1;
      await serialize(entry, async () => {
        if (registry.get(sandboxId) !== entry) return;
        await cleanupAfterSandbox(sandboxId, entry, activeProvider);
      });
    },
    materializeMcpServers(servers) {
      if (
        !currentAllocation &&
        plan.candidates.some(
          (candidate) => candidate.consumer.kind === "http_mcp",
        )
      ) {
        throw new Error(
          "Daytona MCP credentials cannot be materialized without the process-local Secret allocation.",
        );
      }
      return withMcpPlaceholders(servers, currentAllocation);
    },
  };

  return new Proxy(facade as T & ProcessLocalDaytonaSecretProvider, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      const activeProvider = providerFor({});
      const value = Reflect.get(activeProvider, property);
      return typeof value === "function" ? value.bind(activeProvider) : value;
    },
  });
}

export function materializeDaytonaMcpServers(
  provider: unknown,
  servers: McpServerConfig[] | undefined,
): McpServerConfig[] | undefined {
  if (
    typeof provider === "object" &&
    provider !== null &&
    "materializeMcpServers" in provider &&
    typeof provider.materializeMcpServers === "function"
  ) {
    return provider.materializeMcpServers(servers);
  }
  return servers;
}
