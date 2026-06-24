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
  PolicyResponder,
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
import { probeCapabilities } from "./sandbox_agent/capabilities.ts";
import {
  buildDaemonEnv,
  resolveDaemonBinary,
} from "./sandbox_agent/daemon.ts";
import {
  createCookieFetch,
  prepareDaytonaPiAssets,
} from "./sandbox_agent/daytona.ts";
import { conciseError } from "./sandbox_agent/errors.ts";
import { buildSessionMcpServers } from "./sandbox_agent/mcp.ts";
import { applyModel } from "./sandbox_agent/model.ts";
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

export { buildTurnText, messageTranscript } from "./sandbox_agent/transcript.ts";
export { toAcpMcpServers } from "./sandbox_agent/mcp.ts";

function log(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

type Log = (message: string) => void;

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

  const env = (deps.buildDaemonEnv ?? buildDaemonEnv)(plan.acpAgent);
  Object.assign(env, plan.secrets); // local daemon inherits the provider keys
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
  let workspace: { cleanup: () => Promise<void> } | undefined = plan.isDaytona
    ? undefined
    : { cleanup: async () => rmSync(plan.cwd, { recursive: true, force: true }) };

  try {
    // Persist events in-process so a follow-up turn can resume by session id.
    const persist = deps.createPersist?.() ?? new InMemorySessionPersistDriver();
    const startSandboxAgent =
      deps.startSandboxAgent ??
      ((options: Parameters<typeof SandboxAgent.start>[0]) => SandboxAgent.start(options));
    sandbox = await startSandboxAgent({
      sandbox: (deps.buildSandboxProvider ?? buildSandboxProvider)(
        plan.sandboxId,
        env,
        binaryPath,
        piExtEnv,
        plan.secrets,
      ),
      persist,
      // Propagate caller cancellation (a client disconnect on the streaming HTTP edge) so an
      // in-flight run aborts instead of finishing unobserved. The `finally` still disposes.
      ...(signal ? { signal } : {}),
      // Daytona's preview proxy authenticates with a per-sandbox cookie; carry it across
      // requests so ACP calls after the first don't 401. Harmless for local.
      ...(plan.isDaytona ? { fetch: (deps.createCookieFetch ?? createCookieFetch)() } : {}),
    });

    // On Daytona, push the harness login, the extension, and AGENTS.md into the remote
    // sandbox via the filesystem API (nothing secret is baked into the image). Locally
    // these use the host filesystem and the harness's own login (PI_CODING_AGENT_DIR).
    if (plan.isDaytona) {
      await prepareDaytonaPiAssets({ sandbox, plan, log: logger });
    }
    workspace = await (deps.prepareWorkspace ?? prepareWorkspace)({ sandbox, plan, log: logger });

    // Probe what this harness supports and branch on capabilities, not on the harness
    // name. Tool delivery: Pi loads our extension (native tools, set up above); any other
    // harness takes tools over MCP only when it advertises `mcpTools` (pi-acp does not
    // forward MCP, Claude/Codex do).
    const capabilities = await (deps.probeCapabilities ?? probeCapabilities)(sandbox, plan.acpAgent);
    const mcpServers = buildSessionMcpServers({
      isPi: plan.isPi,
      capabilities,
      harness: plan.harness,
      toolSpecs: plan.toolSpecs,
      userMcpServers: request.mcpServers,
      toolCallback: request.toolCallback as ToolCallbackContext | undefined,
      relayDir: plan.relayDir,
      log: logger,
    });

    const session = await sandbox.createSession({
      agent: plan.acpAgent,
      cwd: plan.cwd,
      sessionInit: { cwd: plan.cwd, mcpServers },
    });
    const sessionId = resolveRunSessionId(request, session.id);

    // Resolve the model first: when the harness rejects the requested id and keeps its
    // own default (e.g. Claude ignores "gpt-5.5"), `model` is undefined and the chat span
    // is labelled "chat" instead of falsely claiming the requested model.
    const model = await (deps.applyModel ?? applyModel)(session, request.model, logger);

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
      messages: [...priorMessages(request), { role: "user", content: plan.prompt }],
    });

    session.onEvent((event: any) => {
      const payload = event?.payload;
      const update = payload?.params?.update ?? payload?.update;
      if (update) run.handleUpdate(update);
    });

    attachPermissionResponder({
      session,
      run,
      responder:
        deps.responderFactory?.(request.permissionPolicy) ??
        new PolicyResponder(policyFromRequest(request.permissionPolicy)),
    });

    if (plan.useToolRelay) {
      toolRelay = (deps.startToolRelay ?? startToolRelay)(
        plan.isDaytona
          ? (deps.sandboxRelayHost ?? sandboxRelayHost)(sandbox)
          : (deps.localRelayHost ?? localRelayHost)(),
        plan.relayDir,
        plan.toolSpecs,
        request.toolCallback as ToolCallbackContext | undefined,
      );
    }

    const result = await session.prompt([{ type: "text", text: plan.turnText }]);
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
      capabilities: { ...capabilities, streamingDeltas: !!emit && capabilities.streamingDeltas },
      sessionId,
      model: model ?? request.model,
      traceId: run.traceId(),
    };
  } catch (err) {
    otel?.finish();
    await otel?.flush().catch(() => {});
    return { ok: false, error: conciseError(err, plan.harness) };
  } finally {
    await toolRelay?.stop().catch(() => {});
    await sandbox?.destroySandbox().catch(() => {});
    await sandbox?.dispose().catch(() => {});
    await workspace?.cleanup().catch(() => {});
    // The per-run Agenta agent dir (skills isolation) is throwaway; remove it too.
    if (runAgentDir) rmSync(runAgentDir, { recursive: true, force: true });
    // Remove the per-run skills temp root the materializer created (success or error).
    plan.skillsCleanup();
  }
}
