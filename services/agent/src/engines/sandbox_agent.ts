/**
 * WP-8 sandbox-agent harness driver.
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
 * Tracing is built here from the ACP event stream (see tracing/otel.ts createSandboxAgentOtel),
 * so it is uniform across every harness and always nests under the caller's /invoke
 * span. stdout is reserved for the JSON result (see cli.ts); logs go to stderr.
 */
import { rmSync } from "node:fs";

import { SandboxAgent, InMemorySessionPersistDriver } from "sandbox-agent";

import { createSandboxAgentOtel } from "../tracing/otel.ts";
import {
  localRelayHost,
  sandboxRelayHost,
  startToolRelay,
} from "../tools/relay.ts";
import {
  HITLResponder,
  extractApprovalDecisions,
  policyFromRequest,
  type Responder,
} from "../responder.ts";
import {
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
  type ToolCallbackContext,
  resolveRunSessionId,
} from "../protocol.ts";
import {
  assert,
  assertRequiredCapabilities,
  probeCapabilities,
} from "./sandbox_agent/capabilities.ts";
import { buildDaemonEnv, resolveDaemonBinary } from "./sandbox_agent/daemon.ts";
import {
  createCookieFetch,
  prepareDaytonaPiAssets,
} from "./sandbox_agent/daytona.ts";
import { conciseError } from "./sandbox_agent/errors.ts";
import { buildSessionMcpServers } from "./sandbox_agent/mcp.ts";
import { applyModel } from "./sandbox_agent/model.ts";
import { findSwallowedPiError } from "./sandbox_agent/pi-error.ts";
import {
  buildPiExtensionEnv,
  prepareLocalPiAssets,
} from "./sandbox_agent/pi-assets.ts";
import { attachPermissionResponder } from "./sandbox_agent/permissions.ts";
import { buildSandboxProvider } from "./sandbox_agent/provider.ts";
import {
  buildRunPlan,
  type BuildRunPlanDeps,
} from "./sandbox_agent/run-plan.ts";
import { priorMessages } from "./sandbox_agent/transcript.ts";
import { resolveRunUsage } from "./sandbox_agent/usage.ts";
import { prepareWorkspace } from "./sandbox_agent/workspace.ts";

export {
  buildTurnText,
  messageTranscript,
} from "./sandbox_agent/transcript.ts";
export { toAcpMcpServers } from "./sandbox_agent/mcp.ts";

function log(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

type Log = (message: string) => void;

const CLAUDE_STRICT_DEPLOYMENTS = new Set([
  "custom",
  "bedrock",
  "vertex",
  "vertex_ai",
]);

function applyClaudeConnectionEnv(
  env: Record<string, string>,
  request: AgentRunRequest,
  acpAgent: string,
  logger: Log,
): boolean {
  if (acpAgent !== "claude") return false;

  const deployment = request.deployment;
  const selectedModel = request.model;
  const baseUrl = request.endpoint?.baseUrl;
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    logger(`claude base_url: ${baseUrl}`);
  }

  if (deployment === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    const region = request.endpoint?.region;
    if (region) {
      env.AWS_REGION = region;
      env.AWS_DEFAULT_REGION ??= region;
    }
  } else if (deployment === "vertex" || deployment === "vertex_ai") {
    env.CLAUDE_CODE_USE_VERTEX = "1";
  }

  if (
    selectedModel &&
    (baseUrl || (deployment && CLAUDE_STRICT_DEPLOYMENTS.has(deployment)))
  ) {
    env.ANTHROPIC_MODEL = selectedModel;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = selectedModel;
    return true;
  }
  return false;
}

export interface SandboxAgentDeps extends BuildRunPlanDeps {
  startSandboxAgent?: typeof SandboxAgent.start;
  createPersist?: () => InMemorySessionPersistDriver;
  createOtel?: typeof createSandboxAgentOtel;
  buildDaemonEnv?: typeof buildDaemonEnv;
  resolveDaemonBinary?: typeof resolveDaemonBinary;
  buildSandboxProvider?: typeof buildSandboxProvider;
  createCookieFetch?: typeof createCookieFetch;
  prepareWorkspace?: typeof prepareWorkspace;
  probeCapabilities?: typeof probeCapabilities;
  applyModel?: typeof applyModel;
  startToolRelay?: typeof startToolRelay;
  localRelayHost?: typeof localRelayHost;
  sandboxRelayHost?: typeof sandboxRelayHost;
  responderFactory?: (permissionPolicy: string | undefined) => Responder;
  log?: Log;
}

export async function runSandboxAgent(
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  deps: SandboxAgentDeps = {},
): Promise<AgentRunResult> {
  const logger = deps.log ?? log;
  const planResult = buildRunPlan(request, {
    sandboxProvider: deps.sandboxProvider,
    createLocalCwd: deps.createLocalCwd,
    createDaytonaCwd: deps.createDaytonaCwd,
    resolveSkillDirs: deps.resolveSkillDirs,
    log: logger,
  });
  if (!planResult.ok) return { ok: false, error: planResult.error };
  const plan = planResult.plan;

  // Clear-then-apply (Security rule 5): on a managed run (credentialMode "env") the daemon
  // inherits NONE of the sidecar's own provider keys, so only the resolved `plan.secrets` are
  // present and an inherited key for another provider cannot leak. For runtime_provided/none/
  // un-migrated runs the harness uses its own login, so the inherited keys stay.
  const clearProviderEnv = plan.credentialMode === "env";
  const env = (deps.buildDaemonEnv ?? buildDaemonEnv)(plan.acpAgent, {
    clearProviderEnv,
  });
  Object.assign(env, plan.secrets); // apply only the resolved provider keys
  const strictModel = applyClaudeConnectionEnv(
    env,
    request,
    plan.acpAgent,
    logger,
  );
  // Pi self-instruments locally: propagate the trace context + public tool metadata into Pi
  // via the Agenta extension. Tool execution always relays back to this runner, which keeps
  // private specs, scoped env, callback endpoints, and callback auth in memory.
  const piExtEnv = plan.isPi
    ? buildPiExtensionEnv(request, !plan.isDaytona, {
        relayDir: plan.relayDir,
        usageOutPath: plan.usageOutPath,
      })
    : {};
  Object.assign(env, piExtEnv); // local daemon inherits it; daytona gets it via envVars
  // undefined is fine: the local provider runs its own resolution and errors clearly.
  const binaryPath = (deps.resolveDaemonBinary ?? resolveDaemonBinary)();
  const runAgentDir = prepareLocalPiAssets({ plan, env, log: logger });

  logger(`harness=${plan.harness} sandbox=${plan.sandboxId} cwd=${plan.cwd}`);

  // Pi traces itself via the extension under the propagated traceparent; for other
  // harnesses we build the span tree here from the ACP event stream. Created below, once
  // the model is resolved, so the chat span carries the harness's actual model rather
  // than the requested one. Declared here so the catch can flush a partial trace.
  let sandbox: any | undefined;
  let otel: ReturnType<typeof createSandboxAgentOtel> | undefined;
  // Daytona tool relay loop (started once the session exists, stopped after the prompt).
  let toolRelay: { stop: () => Promise<void> } | undefined;
  // Internal gateway-tool MCP server closer (set when an internal channel is built for a non-Pi
  // harness with executable tools; a no-op otherwise). Released in the `finally`.
  let closeToolMcp: (() => Promise<void>) | undefined;
  let workspace: { cleanup: () => Promise<void> } | undefined = plan.isDaytona
    ? undefined
    : {
        cleanup: async () => rmSync(plan.cwd, { recursive: true, force: true }),
      };

  try {
    // Persist events in-process so a follow-up turn can resume by session id.
    const persist =
      deps.createPersist?.() ?? new InMemorySessionPersistDriver();
    const startSandboxAgent =
      deps.startSandboxAgent ??
      ((options: Parameters<typeof SandboxAgent.start>[0]) =>
        SandboxAgent.start(options));
    sandbox = await startSandboxAgent({
      sandbox: (deps.buildSandboxProvider ?? buildSandboxProvider)(
        plan.sandboxId,
        env,
        binaryPath,
        piExtEnv,
        plan.secrets,
        plan.sandboxPermission,
      ),
      persist,
      // Propagate caller cancellation (a client disconnect on the streaming HTTP edge) so an
      // in-flight run aborts instead of finishing unobserved. The `finally` still disposes.
      ...(signal ? { signal } : {}),
      // Daytona's preview proxy authenticates with a per-sandbox cookie; carry it across
      // requests so ACP calls after the first don't 401. Harmless for local.
      ...(plan.isDaytona
        ? { fetch: (deps.createCookieFetch ?? createCookieFetch)() }
        : {}),
    });

    // On Daytona, push the harness login, the extension, and AGENTS.md into the remote
    // sandbox via the filesystem API (nothing secret is baked into the image). Locally
    // these use the host filesystem and the harness's own login (PI_CODING_AGENT_DIR).
    if (plan.isDaytona) {
      await prepareDaytonaPiAssets({ sandbox, plan, log: logger });
    }
    workspace = await (deps.prepareWorkspace ?? prepareWorkspace)({
      sandbox,
      plan,
      log: logger,
    });

    // Sandbox-start invariant: `startSandboxAgent` must hand back a usable handle, or the
    // probe/createSession below fail with an opaque "cannot read property of undefined".
    assert(
      sandbox && typeof sandbox.createSession === "function",
      `sandbox provider '${plan.sandboxId}' returned no usable sandbox handle`,
    );

    // Probe what this harness supports and branch on capabilities, not on the harness
    // name. Tool delivery: Pi loads our extension (native tools, set up above); any other
    // harness takes tools over MCP only when it advertises `mcpTools` (pi-acp does not
    // forward MCP, Claude/Codex do).
    const probed = await (deps.probeCapabilities ?? probeCapabilities)(
      sandbox,
      plan.acpAgent,
    );
    const capabilities = probed.capabilities;

    // Fail loud (A7): a run that REQUIRES a capability the harness lacks errors with a
    // specific message instead of silently dropping the behavior, the way the
    // `*_UNSUPPORTED_MESSAGE` gates in `run-plan.ts` do. Today: tool delivery to a non-Pi
    // harness whose probe reports `mcpTools:false` / `toolCalls:false`. The throw is caught
    // below and returned as `{ ok: false, error }`.
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
      toolSpecs: plan.toolSpecs,
      userMcpServers: request.mcpServers,
      relayDir: plan.relayDir,
      log: logger,
    });
    // Close the internal gateway-tool MCP server (if one started) when the run ends.
    closeToolMcp = sessionMcp.close;

    const session = await sandbox.createSession({
      agent: plan.acpAgent,
      cwd: plan.cwd,
      sessionInit: { cwd: plan.cwd, mcpServers: sessionMcp.servers },
    });
    const sessionId = resolveRunSessionId(request, session.id);

    // Resolve the model first: when the harness rejects the requested id and keeps its
    // own default (e.g. Claude ignores "gpt-5.5"), `model` is undefined and the chat span
    // is labelled "chat" instead of falsely claiming the requested model.
    const model = await (deps.applyModel ?? applyModel)(
      session,
      request.model,
      logger,
      { strict: strictModel },
    );

    const run = (deps.createOtel ?? createSandboxAgentOtel)({
      harness: plan.harness,
      model,
      traceparent: request.trace?.traceparent,
      baggage: request.trace?.baggage,
      endpoint: request.trace?.endpoint,
      authorization: request.trace?.authorization,
      captureContent: request.trace?.captureContent,
      emitSpans: !plan.isPi || plan.isDaytona,
      emit,
    });
    otel = run;

    run.start({
      prompt: plan.prompt,
      sessionId,
      messages: [
        ...priorMessages(request),
        { role: "user", content: plan.prompt },
      ],
    });

    session.onEvent((event: any) => {
      const payload = event?.payload;
      const update = payload?.params?.update ?? payload?.update;
      if (update) run.handleUpdate(update);
    });

    // Cross-turn HITL: when the request carries a platform `sessionId` it came through the
    // `/messages` endpoint, which validates and stamps a session id on every turn and replays
    // the conversation — i.e. there is a browser that can answer a permission prompt. The
    // headless `/invoke` path sets no session id. With no human surface and no stored
    // decisions the HITLResponder falls back to the base policy and is byte-identical to the
    // old PolicyResponder, so `/invoke` is unchanged.
    const hasHumanSurface = !!(request.sessionId && request.sessionId.trim());
    attachPermissionResponder({
      session,
      run,
      responder:
        deps.responderFactory?.(request.permissionPolicy) ??
        new HITLResponder(
          extractApprovalDecisions(request),
          policyFromRequest(request.permissionPolicy),
          hasHumanSurface,
        ),
    });

    if (plan.useToolRelay) {
      // Layer 3 (S3b): the relay enforces each resolved tool's `permission`; an `ask`/unset
      // permission degrades to the run's headless permission policy (the same policy the
      // PolicyResponder uses for Claude builtins above).
      toolRelay = (deps.startToolRelay ?? startToolRelay)(
        plan.isDaytona
          ? (deps.sandboxRelayHost ?? sandboxRelayHost)(sandbox)
          : (deps.localRelayHost ?? localRelayHost)(),
        plan.relayDir,
        plan.toolSpecs,
        request.toolCallback as ToolCallbackContext | undefined,
        policyFromRequest(request.permissionPolicy),
      );
    }

    const result = await session.prompt([
      { type: "text", text: plan.turnText },
    ]);
    await toolRelay?.stop();
    const stopReason = (result as any)?.stopReason;
    logger(`prompt stopReason=${stopReason}`);

    // Usage: Pi writes its totals to a file via the extension. Other harnesses report the
    // input/output token split on the PromptResponse and the cost on ACP `usage_update`,
    // so combine the two (the stream alone carries no per-call token split). Read and stamp
    // this before finish/flush so exported spans and final events carry the final usage.
    const usage = await resolveRunUsage({
      sandbox,
      usageOutPath: plan.usageOutPath,
      isDaytona: plan.isDaytona,
      promptResult: result,
      streamUsage: run.usage(),
    });
    run.setUsage(usage);

    const output = run.finish();
    await run.flush();

    // Fail loud on a swallowed model error (A7 / "fail loud, not silent"). When Pi's provider
    // call fails (out-of-quota, bad key, rate limit, unknown model, ...), Pi's pi-acp bridge
    // reports the turn as a plain `end_turn` with NO content, so without this the run would
    // return an `ok:true` empty turn and the user would see a silent "No response" instead of
    // the real failure. On the LOCAL Pi path the error is recoverable from Pi's own session
    // transcript; surface it as a run error. Only checked when the turn produced no output and
    // ran no tools (a real tool-only turn legitimately has empty text), and never on Daytona
    // (the transcript lives in the remote sandbox).
    if (
      plan.isPi &&
      !plan.isDaytona &&
      !output.trim() &&
      !run.events().some((e) => e.type === "tool_call")
    ) {
      const piError = findSwallowedPiError(plan.sourcePiAgentDir, plan.cwd);
      if (piError) {
        return {
          ok: false,
          error: conciseError(
            new Error(piError),
            plan.harness,
            request.provider,
          ),
        };
      }
    }

    return {
      ok: true,
      output,
      messages: output ? [{ role: "assistant", content: output }] : [],
      // Streaming already delivered every event live, so the terminal result carries none
      // (re-sending would double them on the consumer).
      events: emit ? [] : run.events(),
      usage,
      stopReason,
      // `streamingDeltas` advertises end-to-end live deltas, which is only true when a live
      // sink is wired. The one-shot path reports false even when the harness produces deltas.
      capabilities: {
        ...capabilities,
        streamingDeltas: !!emit && capabilities.streamingDeltas,
      },
      sessionId,
      model: model ?? request.model,
      traceId: run.traceId(),
    };
  } catch (err) {
    otel?.finish();
    await otel?.flush().catch(() => {});
    return {
      ok: false,
      error: conciseError(err, plan.harness, request.provider),
    };
  } finally {
    await toolRelay?.stop().catch(() => {});
    await closeToolMcp?.().catch(() => {});
    await sandbox?.destroySandbox().catch(() => {});
    await sandbox?.dispose().catch(() => {});
    await workspace?.cleanup().catch(() => {});
    // The per-run Agenta agent dir (skills isolation) is throwaway; remove it too.
    if (runAgentDir) rmSync(runAgentDir, { recursive: true, force: true });
    // Remove the per-run skills temp root the materializer created (success or error).
    plan.skillsCleanup();
  }
}
