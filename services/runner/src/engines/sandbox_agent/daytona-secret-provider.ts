import type { McpServerConfig } from "../../protocol.ts";
import { createDaytonaCredentialDeliveryPort } from "../../providers/daytona-credential-delivery.ts";
import type {
  CredentialDeliveryCapabilities,
  CredentialDeliveryPort,
} from "../../providers/credential-delivery-port.ts";
import { DaytonaReconnectTerminalError } from "./daytona-provider.ts";
import { planSlotKeys, type DaytonaSecretPlan } from "./daytona-secret-plan.ts";
import {
  allocateDaytonaSecrets,
  DaytonaSecretLease,
  deleteDaytonaSecrets,
  isDaytonaNotFound,
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
  /** The claim on this sandbox's Secrets. `attached` for as long as the entry lives. */
  lease: DaytonaSecretLease;
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
  /**
   * Keep THIS sandbox's Secrets when it is destroyed, rather than deleting them.
   *
   * Called by the acquire path when the credential preflight convicts the sandbox. The destroy
   * runs through the sandbox-agent handle, so the intent cannot ride on the destroy call itself.
   * It is keyed by sandbox id so it can only ever affect the cleanup of the named sandbox, and
   * the key is consumed by that cleanup.
   *
   * Takes either id shape: the raw provider id, or the sandbox-agent handle's
   * `"<provider>/<rawId>"`, which is the one the acquire path holds. See `namesSandbox`.
   */
  retainSecretsOnDestroy(sandboxId: string): void;
  /** The lease a retained destroy handed back. Returned once; undefined if nothing was kept. */
  takeSecretLease(): DaytonaSecretLease | undefined;
  /**
   * How a rotated credential reaches THIS sandbox without rebuilding it.
   *
   * Undefined until an allocation is current (before create, or after the sandbox was cleaned up),
   * and undefined for a plan with no hideable credentials — there is no reference to rotate, so
   * there is no live delivery to offer, and the caller correctly falls back to a rebuild.
   */
  credentialDeliveryPort(): CredentialDeliveryPort | undefined;
}

export interface ProcessLocalSecretDependencies {
  registry?: Map<string, RegistryEntry>;
  /**
   * Hash of all create-time routing, environment, and sandbox config: the sandbox's GENERATION id.
   *
   * REQUIRED, and that is the point of it (lifecycle migration, step 9). It used to default to
   * `JSON.stringify(plan)` — a raw-value serialization of every credential in the run, held for
   * the sandbox's whole parked life and compared on every reconnect. Nothing passed the default in
   * production, so it protected nobody and only waited for a new caller to reintroduce it.
   */
  createFingerprint: string;
  /** Capability override for the delivery port. See `DaytonaCredentialDeliveryDeps`. */
  credentialCapabilities?: CredentialDeliveryCapabilities;
  /**
   * A detached lease on Secrets an earlier sandbox of this run kept. `create` mounts them as-is.
   *
   * This is how a sandbox convicted by the credential preflight is rebuilt on the SAME Secret,
   * which is the case Daytona support confirmed works. With no inherited lease, `create` allocates
   * a fresh one, exactly as it always did. A lease this run cannot use, because its slot set does
   * not match the plan or because it is no longer detached, is released and replaced.
   */
  inheritedLease?: DaytonaSecretLease;
  cleanupDelayMilliseconds: number;
  setCleanupTimer?: typeof setTimeout;
  clearCleanupTimer?: typeof clearTimeout;
  log?: (message: string) => void;
}

const processLocalRegistry = new Map<string, RegistryEntry>();

/** The name this facade reports, and therefore the prefix in the handle's `"<name>/<rawId>"`. */
const PROVIDER_NAME = "daytona";

/**
 * Whether `requested` names the sandbox a cleanup is about.
 *
 * TWO ID SHAPES, ONE SANDBOX. This registry is keyed by the RAW id the provider returned from
 * create, but the sandbox-agent handle exposes `"<provider>/<rawId>"` and that prefixed form is
 * what the runner stores, reconnects with, and therefore has in hand. Accepting both is what lets
 * `retainSecretsOnDestroy` be called with the id the caller actually holds, instead of making it
 * reach into the vendored client for a private raw-id field.
 */
function namesSandbox(requested: string, sandboxId: string): boolean {
  return (
    requested === sandboxId || requested === `${PROVIDER_NAME}/${sandboxId}`
  );
}

function plansMatch(entry: RegistryEntry, createFingerprint: string): boolean {
  return entry.createFingerprint === createFingerprint;
}

/** Whether an allocation's slots are exactly the ones a plan asks for. Identities only. */
function slotSetsMatch(
  allocation: DaytonaSecretAllocation,
  plan: DaytonaSecretPlan,
): boolean {
  const allocated = [...allocation.bySlot.keys()].sort();
  const wanted = planSlotKeys(plan);
  return (
    allocated.length === wanted.length &&
    allocated.every((key, index) => key === wanted[index])
  );
}

async function destroySandboxIdempotently(
  provider: DaytonaProviderLike,
  sandboxId: string,
): Promise<void> {
  try {
    await provider.destroy(sandboxId);
  } catch (error) {
    if (!isDaytonaNotFound(error)) throw error;
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
    const headers = server.connection?.headers;
    const credentials = server.connection?.credentials;
    if (
      Object.keys(headers ?? {}).length === 0 &&
      (credentials?.length ?? 0) === 0
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
      connection: {
        ...server.connection,
        headers: headers
          ? Object.fromEntries(
              Object.keys(headers).map((name) => {
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
        credentials: credentials?.map((credential) => {
          const placeholder = placeholders[credential.binding.name];
          if (!placeholder) {
            throw new Error(
              `Daytona Secret allocation is missing MCP placeholder '${credential.binding.name}'.`,
            );
          }
          return { ...credential, value: placeholder };
        }),
      },
    };
  });
}

/**
 * Wrap Daytona provisioning with process-local Secret allocation.
 *
 * A parked sandbox and its allocation live in the registry together. Secret ownership is
 * process-local BY DESIGN: the registry dies with the runner process, so a hard crash can
 * orphan a Daytona Secret (until Daytona's auto-delete backstop reaps the sandbox). This is an
 * accepted limit of the process_local mode, not a bug to patch here — durable reconciliation
 * is an explicit follow-up (PR B of the Daytona-Secrets design; see PR #5278).
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
  const createFingerprint = dependencies.createFingerprint;
  const inheritedLease = dependencies.inheritedLease;
  let provider: T | undefined;
  let currentAllocation: DaytonaSecretAllocation | undefined;
  // The sandbox the current allocation belongs to, so the delivery port can name the environment
  // it serializes on. Cleared wherever the allocation is.
  let currentSandboxId: string | undefined;
  // The sandbox whose Secrets the next cleanup must keep. See `retainSecretsOnDestroy`.
  let retainSecretsForSandbox: string | undefined;
  let retainedLease: DaytonaSecretLease | undefined;

  const providerFor = (attachments: Record<string, string>): T => {
    provider ??= buildProvider(attachments);
    return provider;
  };

  /**
   * Give a failed cleanup a later attempt, instead of forgetting the sandbox and its Secrets.
   *
   * A cleanup can fail in two places and both used to end the same way: the caller swallowed the
   * rejection, the environment was already marked destroyed and dropped from the in-flight map,
   * and nothing was left holding the pair. The registry entry survives either failure, so the
   * same timer the park path uses can run the whole cleanup again. Reuses the entry's generation
   * counter, so a later explicit destroy, pause, or reconnect cancels this retry and wins.
   */
  const armCleanupRetry = (
    sandboxId: string,
    entry: RegistryEntry,
    activeProvider: T,
    reason: string,
    error: unknown,
  ): void => {
    log(
      `process-local Daytona cleanup failed sandbox=${sandboxId} reason=${reason}: ` +
        `${String(error instanceof Error ? error.message : error).slice(0, 200)}; ` +
        `retrying in ${dependencies.cleanupDelayMilliseconds}ms`,
    );
    if (entry.cleanupTimer) return;
    entry.generation += 1;
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
      }).catch(() => {
        // The retry arms its own next attempt, so there is nothing to add here.
      });
    }, dependencies.cleanupDelayMilliseconds);
    entry.cleanupTimer.unref?.();
  };

  const cleanupAfterSandbox = async (
    sandboxId: string,
    entry: RegistryEntry,
    activeProvider: T,
  ): Promise<void> => {
    // A Secret remains mounted until Daytona confirms the sandbox is absent. Never reverse this
    // order, including timer cleanup and create compensation after an id was returned.
    try {
      await destroySandboxIdempotently(activeProvider, sandboxId);
    } catch (error) {
      // Absence is UNPROVEN, so the Secrets stay and the lease stays attached: the sandbox may
      // still be running with them mounted. Keep the entry and try the whole cleanup again.
      armCleanupRetry(sandboxId, entry, activeProvider, "destroy", error);
      throw error;
    }
    // The sandbox is gone, so the lease no longer belongs to it either way. What differs is who
    // deletes: a retained cleanup hands the detached lease to the caller, and every other cleanup
    // releases it here.
    entry.lease.detach();
    if (
      retainSecretsForSandbox !== undefined &&
      namesSandbox(retainSecretsForSandbox, sandboxId)
    ) {
      retainSecretsForSandbox = undefined;
      retainedLease = entry.lease;
    } else {
      try {
        await entry.lease.release();
      } catch (error) {
        // The sandbox is confirmed gone and the lease is detached, so it is still releasable.
        // Keep the entry so the timer can retry the delete; the retried destroy answers 404 and
        // is treated as success, which leaves the release as the only work left to do.
        armCleanupRetry(
          sandboxId,
          entry,
          activeProvider,
          "secret-delete",
          error,
        );
        throw error;
      }
    }
    if (registry.get(sandboxId) === entry) registry.delete(sandboxId);
    if (currentAllocation === entry.lease.allocation) {
      currentAllocation = undefined;
      currentSandboxId = undefined;
    }
  };

  const facade: ProcessLocalDaytonaSecretProvider = {
    name: PROVIDER_NAME,
    async create(...args: unknown[]): Promise<string> {
      // An inherited lease is mounted as-is: no api.create, no new placeholder, and the same
      // Secret behind the new sandbox. That is the whole point of the rebuild path.
      //
      // It is usable only while it is DETACHED and its slots are exactly the ones this plan asks
      // for. A slot mismatch would fail later in `materializeMcpServers` with a message about a
      // missing placeholder rather than about the real cause, so it is caught here and the lease
      // is released instead. The same identities-only comparison guards reconnect below.
      const usable =
        inheritedLease !== undefined &&
        inheritedLease.state === "detached" &&
        slotSetsMatch(inheritedLease.allocation, plan);
      if (inheritedLease && !usable) {
        log(
          `[daytona-secrets] inherited lease unusable state=${inheritedLease.state} ` +
            `slots=${slotSetsMatch(inheritedLease.allocation, plan) ? "match" : "mismatch"}; ` +
            "releasing it and allocating fresh",
        );
        // A delete failure here must not fail the create. The lease stays detached, and the
        // caller that still holds it retries the delete when it releases.
        await inheritedLease.release().catch(() => {});
      }
      const lease = usable
        ? inheritedLease
        : new DaytonaSecretLease(
            await allocateDaytonaSecrets(plan, api, undefined, log),
            api,
            log,
          );
      const allocation = lease.allocation;
      try {
        provider = buildProvider(allocation.attachments);
      } catch (cause) {
        // buildProvider is synchronous and failed before any remote create call, so absence is
        // proven and compensation may safely remove the Secrets. The lease is left DETACHED
        // either way, so whoever holds it deletes exactly once.
        try {
          await lease.release();
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
          lease,
          plan,
          createFingerprint,
          generation: 0,
          operation: Promise.resolve(),
        };
        registry.set(sandboxId, entry);
        lease.attach();
        currentAllocation = allocation;
        currentSandboxId = sandboxId;
        return sandboxId;
      } catch (cause) {
        // The vendored provider creates the remote sandbox before it starts the daemon and only
        // returns the id after both succeed. A rejection therefore cannot prove remote absence.
        // Retain Secrets rather than deleting records that a partially-created sandbox may mount.
        // The lease says so out loud, which is what stops an inherited one from being deleted by
        // the caller that is still holding it.
        lease.markIndeterminate();
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
        // THE SLOT SET, CHECKED SEPARATELY FROM THE GENERATION (lifecycle migration, step 9).
        //
        // Credential material left the create fingerprint so that a ROTATION stops reading as a
        // different sandbox. The slot SET is a different question: this sandbox was created holding
        // one placeholder per allocated slot, and no runner action can add or remove one. If the
        // incoming plan names slots this allocation does not have, the parked sandbox physically
        // cannot serve it — `materializeMcpServers` would fail later, mid-acquire, with a message
        // about a missing placeholder rather than about the real cause.
        //
        // So the identities are reconciled here and FAIL CLOSED, which is what the split promised:
        // immutable topology rebuilds, mutable state reconciles on reconnect or gives up. Slot
        // identities carry no values (consumer, binding, host), so comparing them logs nothing.
        if (!slotSetsMatch(entry.lease.allocation, plan)) {
          await cleanupAfterSandbox(sandboxId, entry, activeProvider);
          throw new DaytonaReconnectTerminalError(
            sandboxId,
            "process-local-secret-slot-set-mismatch",
          );
        }
        currentAllocation = entry.lease.allocation;
        currentSandboxId = sandboxId;
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
    retainSecretsOnDestroy(sandboxId: string): void {
      retainSecretsForSandbox = sandboxId;
    },
    takeSecretLease(): DaytonaSecretLease | undefined {
      const lease = retainedLease;
      retainedLease = undefined;
      return lease;
    },
    credentialDeliveryPort(): CredentialDeliveryPort | undefined {
      // No allocation, no reference to rotate. A plan with no hideable candidates lands here too:
      // its values were passed to Daytona directly and live in the daemon environment, where only
      // a rebuild replaces them. Returning undefined is what routes those back to a rebuild.
      if (!currentAllocation || !currentSandboxId) return undefined;
      if (currentAllocation.bySlot.size === 0) return undefined;
      return createDaytonaCredentialDeliveryPort({
        environmentId: currentSandboxId,
        api,
        bySlot: currentAllocation.bySlot,
        ...(dependencies.credentialCapabilities
          ? { capabilities: dependencies.credentialCapabilities }
          : {}),
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

/**
 * The delivery port of whatever provider this environment ended up with, or undefined.
 *
 * Duck-typed exactly like `materializeDaytonaMcpServers` below and for the same reason: the
 * acquire holds a provider it deliberately does not know the concrete type of. Undefined means
 * "no live credential route exists here", which is the honest answer for the local provider, for
 * a Daytona run with credential hiding switched off (values are plain environment variables in
 * that sandbox, so only a rebuild replaces them), and for a run with nothing hideable.
 */
export function daytonaCredentialDeliveryPort(
  provider: unknown,
): CredentialDeliveryPort | undefined {
  if (
    typeof provider === "object" &&
    provider !== null &&
    "credentialDeliveryPort" in provider &&
    typeof provider.credentialDeliveryPort === "function"
  ) {
    return provider.credentialDeliveryPort();
  }
  return undefined;
}

/**
 * Ask this provider to keep its Secrets when the sandbox is destroyed. No-op for any other one.
 *
 * Duck-typed for the same reason as `daytonaCredentialDeliveryPort`: the acquire path holds a
 * provider whose concrete type it deliberately does not know. A provider without the method has
 * no Secrets to keep, so doing nothing is the honest answer and the caller keeps today's behavior.
 */
export function retainDaytonaSecretsOnDestroy(
  provider: unknown,
  sandboxId: string,
): void {
  if (
    typeof provider === "object" &&
    provider !== null &&
    "retainSecretsOnDestroy" in provider &&
    typeof provider.retainSecretsOnDestroy === "function"
  ) {
    provider.retainSecretsOnDestroy(sandboxId);
  }
}

/** The lease a retained destroy handed back, or undefined. Duck-typed like the setter above. */
export function takeDaytonaSecretLease(
  provider: unknown,
): DaytonaSecretLease | undefined {
  if (
    typeof provider === "object" &&
    provider !== null &&
    "takeSecretLease" in provider &&
    typeof provider.takeSecretLease === "function"
  ) {
    return provider.takeSecretLease() as DaytonaSecretLease | undefined;
  }
  return undefined;
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
