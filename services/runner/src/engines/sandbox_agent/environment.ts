/**
 * Sandbox-agent environment acquisition and session-scoped lifecycle.
 *
 * Drives a coding harness (Pi, Claude Code, ...) over the Agent Client Protocol (ACP)
 * through the `sandbox-agent` daemon, instead of the bespoke Pi SDK calls in the pi
 * engine. It serves the same /run contract (AgentRunRequest -> AgentRunResult), so the
 * Python side stays thin and the choice of harness/sandbox is config, not new code.
 *
 * Per invoke (cold), mirroring the shipped code-evaluator DaytonaRunner pattern:
 *
 *   SandboxAgent.start({ sandbox: local({ env }) | daytona({ create }) })
 *     -> createSession({ agent: <harness>, cwd, model })
 *       -> write AGENTS.md into cwd
 *       -> session.prompt([{ type: "text", text }])
 *         -> accumulate ACP `agent_message_chunk` text + build the trace
 *           -> destroySandbox()
 *
 * Two orthogonal axes swap independently: the sandbox (where the daemon runs) and the
 * harness (which engine). The ACP boundary is daemon-to-harness; the service-to-sandbox-agent
 * hop stays harness-agnostic behind the Harness port.
 *
 * Session keep-alive (flag-gated, off by default) splits the per-invoke work into
 * `acquireEnvironment` (session-scoped: sandbox, mount, session, MCP wiring) and `runTurn`
 * (per-turn: otel run, prompt, usage, trace). `runSandboxAgent` composes them exactly as
 * before (acquire -> runTurn -> destroy), so with the flag off behavior is byte-identical.
 * The dispatch in `server.ts` reuses the two halves to continue a live session across a turn
 * boundary. See docs/design/agent-workflows/projects/session-keepalive/plan.md.
 *
 * Tracing is built here from the ACP event stream (see tracing/otel.ts createSandboxAgentOtel),
 * so it is uniform across every harness and always nests under the caller's /invoke
 * span. stdout is reserved for the JSON result (see cli.ts); logs go to stderr.
 */
import { rmSync } from "node:fs";

import { apiBase } from "../../apiBase.ts";

import {
InMemorySessionPersistDriver,
SandboxAgent,
type SessionEvent,
type SessionPermissionRequest
} from "sandbox-agent";

import {
resolveRunSessionId,
type AgentRunRequest
} from "../../protocol.ts";
import { advertisedToolSpecs } from "../../tools/public-spec.ts";
import { createAcpFetch } from "./acp-fetch.ts";
import {
assert,
assertRequiredCapabilities,
probeCapabilities,
} from "./capabilities.ts";
import { DaytonaReconnectTerminalError } from "./daytona-provider.ts";
import {
createCookieFetch,
DAYTONA_PI_DIR,
prepareDaytonaPiAssets,
} from "./daytona.ts";
import { prepareEnvironmentSetup } from "./environment-setup.ts";
import { conciseError } from "./errors.ts";
import { buildSessionMcpServers } from "./mcp.ts";
import { applyModel } from "./model.ts";
import {
discoverTunnelEndpoint,
harnessSessionMounts,
mountHarnessSessionDirs,
mountStorage,
mountStorageRemote,
signSessionMountCredentials,
storeReachableFromSandbox,
unmountStorage,
type MountCredentials,
} from "./mount.ts";
import { buildSandboxProvider } from "./provider.ts";
import {
clearSandboxPointer,
readStoredSandboxPointer,
writeSandboxPointer,
} from "./sandbox-reconnect.ts";
import {
hydrateHarnessSessionFromDurable
} from "./session-continuity-durable.ts";
import {
eligibleAgentSessionId,
nextTurnIndex,
sessionContinuityStore
} from "./session-continuity.ts";
import {
teardownDisposition,
type TeardownReason,
} from "./teardown.ts";
import {
uploadToolMcpAssets,
type ToolMcpAssets,
} from "./tool-mcp-assets.ts";
import { prepareWorkspace } from "./workspace.ts";

export { toAcpMcpServers } from "./mcp.ts";
export {
buildTurnText,
messageTranscript
} from "./transcript.ts";

function log(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

const LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT = 1;

// In-flight sandbox handles, by run. A process KILL (docker stop / SIGTERM / OOM mid-run) skips
// the per-run teardown — so a shutdown signal handler (see `server.ts`) drains this set to
// best-effort delete any still-running sandbox before exit. Remote (Daytona) sandboxes that even a
// signal can never reach (SIGKILL/OOM) self-reap via the lifecycle reapers in `provider.ts`.
const inFlightSandboxes = new Set<{
  destroy: (opts?: { reason?: TeardownReason }) => Promise<void>;
}>();

/**
 * Best-effort delete every sandbox currently mid-run, bounded so it can never hang shutdown.
 * Called from the process signal handler so `docker stop` reaps remote sandboxes instead of
 * leaking them. Each delete is independent and its own failure is swallowed; the whole sweep is
 * raced against `timeoutMs` so a slow Daytona API call cannot block the exit.
 */
export async function destroyInFlightSandboxes(
  timeoutMs = 5000,
  reason: TeardownReason = "shutdown-in-flight",
): Promise<void> {
  const pending = [...inFlightSandboxes];
  if (pending.length === 0) return;
  const sweep = Promise.allSettled(
    pending.map((environment) =>
      Promise.resolve(environment.destroy({ reason })).catch(() => {}),
    ),
  );
  await Promise.race([
    sweep,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

import type {
AcquireEnvironmentResult,
SandboxAgentDeps
} from "./runtime-contracts.ts";
import {
containsTransportEndpointDisconnected,
isTransportEndpointDisconnected,
runCredential
} from "./runtime-policy.ts";
/**
 * Sign the session's durable mount up front so keep-alive can build a pool key (the mount's
 * owning `projectId`, the FALLBACK project scope when the run carries no service-stamped
 * `runContext.project.id`) and credential epoch without acquiring the whole environment. Returns
 * exactly what the sign yielded: `null` when there is no session/credential to sign with, or
 * the sign returned no usable mount (store unconfigured, 503, ephemeral fallback). The caller
 * threads the result — null included — into `acquireEnvironment` as `presignedMount`, so the
 * mount is signed exactly once per run on every path. A null result no longer forces a cold run
 * on its own: the request still parks when the run context supplied a project scope, and only
 * skips parking when NEITHER source yields one (`poolKeyFor` returns null).
 */
export async function resolveKeepaliveMount(
  request: AgentRunRequest,
  deps: SandboxAgentDeps = {},
): Promise<MountCredentials | null> {
  const logger = deps.log ?? log;
  const sessionForMount = request.sessionId?.trim();
  const runCred = runCredential(request);
  if (!sessionForMount || !runCred) return null;
  const signMount =
    deps.signSessionMountCredentials ?? signSessionMountCredentials;
  return signMount(sessionForMount, {
    apiBase: apiBase(),
    authorization: runCred,
    log: logger,
  });
}

/**
 * Build the session-scoped environment: sign the mount, build the run plan, start the sandbox,
 * mount the durable cwd, prepare the workspace, probe capabilities, wire the internal tool-MCP
 * server, and open the ACP session. Session-lifetime `onEvent`/`onPermissionRequest` listeners
 * are attached once here and demux into `env.currentTurn`.
 *
 * Finalizers register incrementally on `env` as each resource is acquired; a mid-acquire failure
 * runs `env.destroy()` (which null-checks every resource, so a half-built environment cannot
 * leak) and returns `{ ok: false }`, mirroring today's shared teardown. When `presignedMount` is
 * supplied (the keep-alive cold path already signed to build the pool key) the initial sign is
 * skipped so the mount is signed once per run.
 */
export async function acquireEnvironment(
  request: AgentRunRequest,
  deps: SandboxAgentDeps = {},
  signal?: AbortSignal,
  presignedMount?: MountCredentials | null,
): Promise<AcquireEnvironmentResult> {
  const setup = await prepareEnvironmentSetup(request, deps, presignedMount);
  if (!setup.ok) return setup;
  const {
    acquireStartedAt,
    binaryPath,
    deferredClientToolRelay,
    env,
    environment,
    logger,
    mcpAbort,
    piExtEnv,
    plan,
    runCred,
    sessionForMount,
    signMount,
    strictModel,
    timingLog,
  } = setup;
  // The one complete, idempotent teardown — the same steps the old per-run `finally` ran, in the
  // same order. Every resource is null-checked, so it is safe after a partial acquire and safe to
  // call twice (the guard returns on a second call). It must never throw.
  environment.destroy = async (opts?: { reason?: TeardownReason }) => {
    if (environment.destroyed) return;
    environment.destroyed = true;
    await environment.runtimeRemount?.catch(() => {});
    inFlightSandboxes.delete(environment);
    await environment.currentTurn?.toolRelay?.stop().catch(() => {});
    // Teardown backstop: destroy any in-flight loopback `tools/call` before closing the server.
    environment.mcpAbort.abort();
    await environment.closeToolMcp?.().catch(() => {});
    // Graceful `session/cancel` BEFORE tearing down the daemon, or the ACP adapter subprocess
    // reparents to PID 1 and never exits. Skip if the pause path already sent it.
    if (environment.session && !environment.sessionDestroyRequested)
      await environment.sandbox
        ?.destroySession?.(environment.session.id)
        .catch(() => {});
    const disposition = teardownDisposition(opts?.reason ?? "failed-turn");
    let parked = false;
    if (
      disposition === "stop" &&
      plan.isDaytona &&
      environment.sandbox?.pauseSandbox
    ) {
      const sandboxLogId = environment.sandbox.sandboxId ?? plan.sandboxId;
      try {
        await environment.sandbox.pauseSandbox();
        parked = true;
        logger(`parked sandbox=${sandboxLogId}`);
      } catch (err) {
        logger(
          `pause failed sandbox=${sandboxLogId}: ${conciseError(err, plan.harness)}`,
        );
      }
    }
    if (!parked) await environment.sandbox?.destroySandbox().catch(() => {});
    await environment.sandbox?.dispose().catch(() => {});
    // Unmount the durable cwd BEFORE removing the dir: data lives in the store, only the host
    // mountpoint is torn down. If unmount is not CONFIRMED gone, skip the delete: rmSync must
    // never run against a possibly-live FUSE mount into the durable store.
    if (environment.mountedCwd) {
      environment.durableCwdSafeToDelete = await (
        environment.deps.unmountStorage ?? unmountStorage
      )(environment.mountedCwd, { log }).catch(() => false);
    }
    if (!environment.durableCwdSafeToDelete) {
      logger(
        `durable cwd unmount not confirmed, skipping workspace cleanup cwd=${plan.cwd}`,
      );
    } else {
      await environment.workspace?.cleanup().catch(() => {});
    }
    // The per-run Agenta agent dir (skills isolation) is throwaway; remove it too.
    if (environment.runAgentDir)
      rmSync(environment.runAgentDir, { recursive: true, force: true });
    // Backstop: the extension deletes this on read; remove it here too in case the harness never
    // started (or crashed before reading it), so the bearer never lingers.
    if (environment.otlpAuthFilePath)
      rmSync(environment.otlpAuthFilePath, { force: true });
    // Remove the per-run skills temp root the materializer created (success or error).
    plan.skillsCleanup();
  };

  // --- local durable cwd mount helpers (session-scoped, close over environment) ------ //
  const mountLocalDurableCwd = async (reason: string): Promise<boolean> => {
    if (!environment.mountCreds || plan.isDaytona) return false;
    logger(
      `local durable cwd mount (${reason}) session=${sessionForMount} cwd=${plan.cwd}`,
    );
    if (
      await (deps.mountStorage ?? mountStorage)(
        plan.cwd,
        environment.mountCreds,
        {
          log: logger,
        },
      )
    ) {
      environment.mountedCwd = plan.cwd;
      return true;
    }
    return false;
  };
  let localDurableCwdEnotconnRemounts = 0;
  const reSignAndRemountLocalCwd = async (): Promise<boolean> => {
    if (!sessionForMount || !runCred || plan.isDaytona) return false;
    if (
      localDurableCwdEnotconnRemounts >=
      LOCAL_DURABLE_CWD_ENOTCONN_REMOUNT_LIMIT
    ) {
      logger(
        `local durable cwd ENOTCONN remount limit reached session=${sessionForMount} cwd=${plan.cwd}`,
      );
      return false;
    }
    localDurableCwdEnotconnRemounts += 1;
    logger(
      `local durable cwd ENOTCONN session=${sessionForMount} cwd=${plan.cwd}; re-signing and remounting`,
    );
    const fresh = await signMount(sessionForMount, {
      apiBase: apiBase(),
      authorization: runCred,
      log: logger,
    });
    if (!fresh) {
      logger(
        `local durable cwd re-sign returned no credentials session=${sessionForMount}`,
      );
      return false;
    }
    environment.mountCreds = fresh;
    return mountLocalDurableCwd("enotconn-retry");
  };
  const remountLocalCwdAfterRuntimeEnotconn = (event: unknown): void => {
    if (plan.isDaytona || !environment.mountCreds || !environment.mountedCwd)
      return;
    if (
      environment.runtimeRemount ||
      !containsTransportEndpointDisconnected(event)
    )
      return;
    logger(
      `local durable cwd ENOTCONN observed in ACP event session=${sessionForMount} cwd=${plan.cwd}; re-signing and remounting`,
    );
    environment.runtimeRemount = reSignAndRemountLocalCwd().catch((err) => {
      logger(
        `local durable cwd runtime remount failed session=${sessionForMount}: ${conciseError(err, plan.harness)}`,
      );
      return false;
    });
  };

  try {
    // Persist events in-process so a follow-up turn can resume by session id.
    const persist =
      deps.createPersist?.() ?? new InMemorySessionPersistDriver();
    const startSandboxAgent =
      deps.startSandboxAgent ??
      ((options: Parameters<typeof SandboxAgent.start>[0]) =>
        SandboxAgent.start(options));
    const sandboxProvider = (deps.buildSandboxProvider ?? buildSandboxProvider)(
      plan.sandboxId,
      env,
      binaryPath,
      piExtEnv,
      plan.secrets,
      plan.sandboxPermission,
    );
    const startOptions = {
      sandbox: sandboxProvider,
      persist,
      // Propagate caller cancellation (a client disconnect on the streaming HTTP edge) so an
      // in-flight run aborts instead of finishing unobserved. `destroy` still disposes.
      ...(signal ? { signal } : {}),
      // Long-timeout undici dispatcher so a paused HITL turn is not reaped by undici's default
      // headersTimeout; Daytona additionally carries the per-sandbox auth cookie.
      fetch: plan.isDaytona
        ? (deps.createCookieFetch ?? createCookieFetch)()
        : (deps.createAcpFetch ?? createAcpFetch)(),
    };
    // A stored sandbox id is trusted: reconnect it by id and let reconnect converge its network
    // policy to this run's plan. Any reconnect failure falls through to a fresh create. Snapshot
    // and image drift are accepted as per-conversation version pinning, not grounds for a rebuild.
    const storedSandboxPointer =
      plan.isDaytona && sessionForMount && runCred
        ? await (deps.readStoredSandboxPointer ?? readStoredSandboxPointer)(
            sessionForMount,
            { authorization: runCred, log: logger },
          )
        : undefined;
    if (storedSandboxPointer) {
      const sandboxStartStartedAt = Date.now();
      try {
        environment.sandbox = await startSandboxAgent({
          ...startOptions,
          sandboxId: storedSandboxPointer.sandboxId,
        });
        logger(
          `reconnected sandbox=${storedSandboxPointer.sandboxId} session=${sessionForMount}`,
        );
      } catch (err) {
        logger(
          `reconnect failed sandbox=${storedSandboxPointer.sandboxId}, creating fresh: ${conciseError(err, plan.harness)}`,
        );
        if (
          err instanceof DaytonaReconnectTerminalError &&
          sessionForMount &&
          runCred
        ) {
          // The post-hydrate write later in acquire is authoritative. This clear only prevents
          // repeated doomed reconnects if acquire fails before reaching that write. Hydrate
          // first: after a runner restart the in-memory store is behind the durable
          // latest_turn_index, and an unhydrated guard token would be rejected as stale.
          await (
            deps.hydrateHarnessSessionFromDurable ??
            hydrateHarnessSessionFromDurable
          )(
            sessionForMount,
            plan.harness,
            deps.sessionContinuityStore ?? sessionContinuityStore,
            { authorization: runCred, log: logger },
          );
          await (deps.clearSandboxPointer ?? clearSandboxPointer)(
            sessionForMount,
            nextTurnIndex(
              sessionForMount,
              deps.sessionContinuityStore ?? sessionContinuityStore,
            ),
            { authorization: runCred, log: logger },
          );
        }
      } finally {
        timingLog("sandbox_start", sandboxStartStartedAt, " mode=reconnect");
      }
    }
    if (!environment.sandbox) {
      const sandboxStartStartedAt = Date.now();
      try {
        environment.sandbox = await startSandboxAgent(startOptions);
      } finally {
        timingLog("sandbox_start", sandboxStartStartedAt, " mode=create");
      }
    }
    environment.resumable = Boolean(plan.isDaytona && sessionForMount);
    // Track the live handle so a shutdown signal handler can delete it if `destroy` is skipped by
    // a process KILL; removed in `destroy` on every normal exit so it is never double-deleted.
    if (environment.sandbox) inFlightSandboxes.add(environment);

    // On Daytona, push the harness login, the extension, and AGENTS.md into the remote sandbox.
    // For a non-Pi harness with executable tools, also push the in-sandbox stdio MCP shim
    // assets (bundle + public-specs file): a non-Pi harness in the sandbox cannot reach the
    // runner-loopback HTTP MCP channel, so the harness's ACP adapter spawns the uploaded shim
    // as the internal stdio MCP server instead. Uploaded unconditionally for non-Pi (the
    // capability probe runs later; a harness that turns out to lack MCP fails loud in
    // `assertRequiredCapabilities` below). Pi delivers via its extension; local non-Pi uses
    // the loopback HTTP channel — neither needs this. The upload helper THROWS when the shim
    // cannot be delivered (fail loud — this path requires it).
    let internalToolMcp: ToolMcpAssets | undefined;
    if (plan.isDaytona) {
      await (deps.prepareDaytonaPiAssets ?? prepareDaytonaPiAssets)({
        sandbox: environment.sandbox,
        plan,
        log: logger,
      });
      if (!plan.isPi && plan.executableToolSpecs.length > 0) {
        internalToolMcp = await (
          deps.uploadToolMcpAssets ?? uploadToolMcpAssets
        )(
          environment.sandbox,
          plan.toolMcpDir,
          advertisedToolSpecs(plan.executableToolSpecs),
          logger,
        );
      }
    }

    // Durable cwd: mount BEFORE createSession (so the session opens inside it) and BEFORE
    // workspace materialization (so AGENTS.md, harness files, and skills land in the durable
    // prefix instead of being hidden under the FUSE mount).
    if (environment.mountCreds && !plan.isDaytona) {
      await mountLocalDurableCwd("initial");
    }
    if (environment.mountCreds && plan.isDaytona) {
      const mountsStartedAt = Date.now();
      try {
        // Mount against the store's own endpoint when the sandbox can reach it (public S3); fall
        // back to the tunnel only for an in-network store. No tunnel + in-network store => skip.
        const storeEndpoint = environment.mountCreds.endpoint;
        const endpoint = storeReachableFromSandbox(storeEndpoint)
          ? undefined
          : ((await (deps.discoverTunnelEndpoint ?? discoverTunnelEndpoint)({
              log: logger,
            })) ?? undefined);
        const canMount = storeReachableFromSandbox(storeEndpoint) || !!endpoint;
        if (
          canMount &&
          (await (deps.mountStorageRemote ?? mountStorageRemote)(
            environment.sandbox,
            plan.cwd,
            environment.mountCreds,
            {
              endpoint,
              log: logger,
            },
          ))
        ) {
          logger(`remote durable cwd active for session=${sessionForMount}`);
        }
        // Per-harness session/transcript-dir mounts, remote-only by construction (this whole
        // branch is `plan.isDaytona`) — local runs never reach here, so they stay mount-free/
        // byte-identical. Opt-out via env, default on wherever a durable cwd mount is active (no
        // separate credential/session-id path from the cwd mount).
        if (
          canMount &&
          sessionForMount &&
          runCred &&
          process.env.AGENTA_SESSION_HARNESS_MOUNTS !== "false"
        ) {
          const dirs = harnessSessionMounts(
            plan.acpAgent,
            "/home/sandbox",
            DAYTONA_PI_DIR,
          );
          await (deps.mountHarnessSessionDirs ?? mountHarnessSessionDirs)(
            environment.sandbox,
            sessionForMount,
            dirs,
            endpoint,
            {
              apiBase: apiBase(),
              authorization: runCred,
              log: logger,
            },
          );
        }
      } finally {
        timingLog("mounts", mountsStartedAt);
      }
    }

    const prepareWorkspaceStartedAt = Date.now();
    try {
      environment.workspace = await (deps.prepareWorkspace ?? prepareWorkspace)(
        {
          sandbox: environment.sandbox,
          plan,
          log: logger,
        },
      );
    } catch (err) {
      if (
        !plan.isDaytona &&
        environment.mountCreds &&
        isTransportEndpointDisconnected(err) &&
        (await reSignAndRemountLocalCwd())
      ) {
        logger(
          `retrying workspace preparation after local durable cwd remount`,
        );
        environment.workspace = await (
          deps.prepareWorkspace ?? prepareWorkspace
        )({
          sandbox: environment.sandbox,
          plan,
          log: logger,
        });
      } else {
        throw err;
      }
    } finally {
      timingLog("prepare_workspace", prepareWorkspaceStartedAt);
    }

    // Sandbox-start invariant: `startSandboxAgent` must hand back a usable handle.
    assert(
      environment.sandbox &&
        typeof environment.sandbox.createSession === "function",
      `sandbox provider '${plan.sandboxId}' returned no usable sandbox handle`,
    );

    // Probe what this harness supports and branch on capabilities, not on the harness name.
    const probeCapabilitiesStartedAt = Date.now();
    let probed;
    try {
      probed = await (deps.probeCapabilities ?? probeCapabilities)(
        environment.sandbox,
        plan.acpAgent,
      );
    } finally {
      timingLog("probe_capabilities", probeCapabilitiesStartedAt);
    }
    const capabilities = probed.capabilities;
    environment.capabilities = capabilities;

    // Fail loud (A7): a run that REQUIRES a capability the harness lacks errors specifically
    // rather than silently dropping the behavior.
    assertRequiredCapabilities({
      harness: plan.harness,
      isPi: plan.isPi,
      probed,
      toolSpecs: plan.toolSpecs,
      log: logger,
    });

    const sessionMcp = await buildSessionMcpServers({
      isPi: plan.isPi,
      capabilities,
      harness: plan.harness,
      isDaytona: plan.isDaytona,
      toolSpecs: plan.toolSpecs,
      userMcpServers: request.mcpServers,
      relayDir: plan.relayDir,
      clientToolRelay: deferredClientToolRelay,
      signal: mcpAbort.signal,
      // The uploaded in-sandbox stdio MCP shim assets, set only on Daytona + non-Pi +
      // executable-tools; advertises the gateway tools the loopback channel cannot reach
      // from inside the sandbox. No server to close for this entry (the harness owns the
      // shim process), so `sessionMcp.close` semantics are unchanged.
      internalToolMcp,
      log: logger,
    });
    // Close the internal gateway-tool MCP server (if one started) when the session is destroyed.
    environment.closeToolMcp = sessionMcp.close;

    // If this harness authored the conversation's most recent turn (staleness-guarded) and we
    // still remember its native `agentSessionId`, seed the fresh persist driver with a synthetic
    // record and resume-by-id so the patched `resumeSession` reaches `session/load` instead of
    // `session/new`. Any failure inside `resumeSession` already degrades to a plain new session
    // internally (the patch's own `catch {}` around `loadRemoteSession`), so this call is safe to
    // attempt unconditionally whenever we have an eligible id — worst case it is exactly today's
    // cold `createSession`.
    const continuitySessionKey = request.sessionId?.trim();
    const continuityStore =
      deps.sessionContinuityStore ?? sessionContinuityStore;
    // Seed the in-memory store from the durable row before consulting it, so a resume after a
    // runner restart (in-memory map lost) still sees the prior turn's eligibility. No-op (and
    // cheap) when the store already has a live in-process record.
    if (continuitySessionKey && runCred) {
      await (
        deps.hydrateHarnessSessionFromDurable ??
        hydrateHarnessSessionFromDurable
      )(continuitySessionKey, plan.harness, continuityStore, {
        authorization: runCred,
        log: logger,
      });
    }
    const priorAgentSessionId = continuitySessionKey
      ? eligibleAgentSessionId(
          continuitySessionKey,
          plan.harness,
          continuityStore,
        )
      : undefined;
    const localSessionId = continuitySessionKey
      ? `${continuitySessionKey}:${plan.harness}`
      : undefined;
    // The index THIS turn will occupy once it completes: recorded post-turn against the SAME
    // index read here, so a turn that authors turn N leaves the store agreeing with itself.
    environment.continuityTurnIndex = continuitySessionKey
      ? nextTurnIndex(continuitySessionKey, continuityStore)
      : undefined;
    // Daytona only: a local run must not overwrite a conversation's remote pointer (switching
    // sandboxes mid-conversation would strand the parked Daytona instance).
    if (plan.isDaytona && sessionForMount && runCred) {
      const liveSandboxId = environment.sandbox?.sandboxId ?? plan.sandboxId;
      const pointerWriteOutcome = await (
        deps.writeSandboxPointer ?? writeSandboxPointer
      )(
        sessionForMount,
        {
          sandboxId: liveSandboxId,
          turnIndex: environment.continuityTurnIndex ?? 0,
        },
        { authorization: runCred, log: logger },
      );
      logger(
        `sandbox pointer write ${pointerWriteOutcome} session=${sessionForMount} sandbox=${liveSandboxId}`,
      );
    }
    let loadedFromContinuity = false;
    if (priorAgentSessionId && localSessionId) {
      await persist.updateSession({
        id: localSessionId,
        agent: plan.acpAgent,
        agentSessionId: priorAgentSessionId,
        lastConnectionId: "",
        createdAt: Date.now(),
        sessionInit: { cwd: plan.cwd, mcpServers: sessionMcp.servers },
      });
      const createSessionStartedAt = Date.now();
      try {
        environment.session =
          await environment.sandbox.resumeSession(localSessionId);
        loadedFromContinuity =
          environment.session.agentSessionId === priorAgentSessionId;
        logger(
          `[continuity] session/load attempted session=${continuitySessionKey} ` +
            `harness=${plan.harness} loaded=${loadedFromContinuity}`,
        );
      } catch (err) {
        logger(
          `[continuity] resumeSession failed, falling back to cold createSession: ` +
            `${conciseError(err, plan.harness)}`,
        );
      } finally {
        timingLog("create_session", createSessionStartedAt, " mode=load");
      }
    }
    environment.loadedFromContinuity = loadedFromContinuity;
    if (!environment.session) {
      const createSessionStartedAt = Date.now();
      try {
        environment.session = await environment.sandbox.createSession({
          ...(localSessionId ? { id: localSessionId } : {}),
          agent: plan.acpAgent,
          cwd: plan.cwd,
          sessionInit: { cwd: plan.cwd, mcpServers: sessionMcp.servers },
        });
      } finally {
        timingLog("create_session", createSessionStartedAt, " mode=create");
      }
    }
    environment.sessionId = resolveRunSessionId(
      request,
      environment.session.id,
    );

    // Resolve the model first: when the harness rejects the requested id and keeps its own
    // default, `model` is undefined and the chat span is labelled "chat".
    environment.model = await (deps.applyModel ?? applyModel)(
      environment.session,
      request.model,
      logger,
      { strict: strictModel },
    );

    // Session-lifetime listeners: attach ONCE, each demuxing into the active turn's sink. They
    // outlive any single turn, so the routing lives in dedicated non-throwing helpers below.
    environment.session.onEvent((event: SessionEvent) =>
      routeSessionEventToActiveTurn(
        environment,
        remountLocalCwdAfterRuntimeEnotconn,
        event,
      ),
    );
    environment.session.onPermissionRequest((req: SessionPermissionRequest) =>
      routePermissionRequestToActiveTurn(environment, req),
    );

    timingLog("acquire_total", acquireStartedAt);
    return { ok: true, env: environment };
  } catch (err) {
    const error = conciseError(err, plan.harness, request.provider);
    // Mirror today's shared teardown: no otel exists yet during acquire, so there is no partial
    // trace to flush — just run the incrementally-registered finalizers and surface the error.
    await environment.destroy({ reason: "failed-turn" });
    return { ok: false, error };
  }
}

import {
routePermissionRequestToActiveTurn,
routeSessionEventToActiveTurn,
} from "./session-events.ts";
/**
 * The cold, one-turn-per-environment entry (also the flag-off path). Acquire an environment, run
 * one turn, then tear the environment down — exactly as the single `try/finally` did before the
 * split, so behavior here is byte-identical to pre-keep-alive.
 */
/**
 * Drop the harness's continuity record after a turn that did not complete. The harness may have
 * written a partial turn into its native transcript, so a later `session/load` would resume a
 * history the canonical request never sent. Dropping it falls back to cold replay.
 */
export function invalidateContinuity(
  sessionId: string | undefined,
  harness: string,
  deps: SandboxAgentDeps,
): void {
  if (!sessionId) return;
  (deps.sessionContinuityStore ?? sessionContinuityStore).invalidate(
    sessionId,
    harness,
  );
}
