/**
 * Legacy backend: drive the Pi SDK in-process for one cold run.
 *
 * This is the non-sandbox-agent engine. It drives Pi's `createAgentSession` directly: injects
 * AGENTS.md in memory, resolves the model, sends one user turn, and returns the structured
 * result (final text, messages, events, usage, capabilities). It also turns the
 * backend-resolved runnable tools (WP-7) into Pi customTools that route back through
 * Agenta's /tools/call. The sandbox-agent engine (`engines/sandbox_agent.ts`) is the ACP path; both serve the
 * same `/run` contract (see `protocol.ts`).
 *
 * Auth: provider keys arrive as `request.secrets` (applied to the env) or fall back to the
 * local Pi login (`AuthStorage.create()` reads ~/.pi/agent/auth.json). Nothing
 * invocation-specific is written to a persistent disk: the session is in-memory and the
 * working dir is a throwaway temp dir.
 *
 * Important: stdout is reserved for the JSON result (see cli.ts). Everything here logs to
 * stderr so it never pollutes the result channel.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { createAgentaOtel } from "../tracing/otel.ts";
import {
  type AgentEvent,
  type AgentRunRequest,
  type AgentRunResult,
  type ChatMessage,
  type EmitEvent,
  type HarnessCapabilities,
  type ResolvedToolSpec,
  type ToolCallbackContext,
  resolveRunSessionId,
  resolvePromptText,
} from "../protocol.ts";
import { KNOWN_PROVIDER_ENV_VARS } from "./sandbox_agent/daemon.ts";
import { EMPTY_OBJECT_SCHEMA } from "../tools/callback.ts";
import { runResolvedTool } from "../tools/dispatch.ts";
import { resolveSkillDirs } from "./skills.ts";

/** What the in-process Pi engine supports. Static (no daemon to probe, unlike sandbox-agent). */
const PI_CAPABILITIES: HarnessCapabilities = {
  textMessages: true,
  toolCalls: true,
  reasoning: true,
  usage: true,
  streamingDeltas: true,
  images: false,
  fileAttachments: false,
  mcpTools: false,
  planMode: false,
  permissions: false,
  sessionLifecycle: false,
};

function log(message: string): void {
  process.stderr.write(`[pi-engine] ${message}\n`);
}

// In-process Pi reads provider keys from process.env. Since process.env is process-global,
// serialize Pi runs while applying request-scoped provider env, then restore the prior env
// exactly so one request's vault keys cannot leak into the next request.
let providerEnvQueue: Promise<void> = Promise.resolve();

export async function withRequestProviderEnv<T>(
  secrets: Record<string, string> | undefined,
  fn: () => Promise<T>,
  // Clear-then-apply (Security rule 5 in the provider-model-auth design): on a MANAGED run
  // (`credentialMode === "env"`) clear ALL `KNOWN_PROVIDER_ENV_VARS` first so an inherited key
  // for another provider cannot leak in, then apply only `secrets`. For runtime_provided/none/
  // un-migrated runs the in-process Pi uses its own env/login, so we do NOT clear.
  credentialMode?: string,
): Promise<T> {
  const clearProviderEnv = credentialMode === "env";
  const run = providerEnvQueue.then(async () => {
    // Snapshot every var we touch so the finally restores the prior process env exactly. The
    // managed case snapshots the whole known set (it clears them); every case snapshots the
    // keys it applies. A var that appears in both is snapshotted once (Map keys dedupe).
    const previous = new Map<string, string | undefined>();
    if (clearProviderEnv) {
      for (const key of KNOWN_PROVIDER_ENV_VARS) {
        if (!previous.has(key)) previous.set(key, process.env[key]);
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(secrets ?? {})) {
      if (!previous.has(key)) previous.set(key, process.env[key]);
      if (value) process.env[key] = value;
      else delete process.env[key];
    }
    try {
      return await fn();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  providerEnvQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Pick the requested model, else gpt-5.5, else a sensible non-mini default. */
function pickModel(available: any[], wanted?: string): any {
  return (
    (wanted &&
      available.find(
        (m) => m.id === wanted || `${m.provider}/${m.id}` === wanted,
      )) ||
    available.find((m) => m.id === "gpt-5.5") ||
    available.find((m) => !/spark|mini/i.test(m.id)) ||
    available[0]
  );
}

/** Concatenate the text blocks of the last assistant message. */
function extractAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((block: any) => block?.type === "text" && block.text)
        .map((block: any) => block.text)
        .join("");
      if (text) return text;
    }
  }
  return "";
}

/** The stop reason of the last assistant message, when Pi set one. */
function lastStopReason(messages: any[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant" && messages[i].stopReason) {
      return String(messages[i].stopReason);
    }
  }
  return undefined;
}

/**
 * Turn resolved tool specs into Pi customTools, branching on the executor `kind`:
 *  - `callback` (default): `execute` POSTs back through Agenta's /tools/call, so the Composio
 *    key and connection auth stay server-side.
 *  - `code`: `execute` runs the snippet in a sandbox subprocess with its scoped secret env.
 *  - `client`: browser-fulfilled, so skipped on the in-process path (no browser to answer).
 *
 * A failed `execute` throws, which Pi turns into a tool-error result (the loop continues)
 * rather than a run failure. Pi accepts a plain JSON Schema for `parameters` (non-TypeBox path).
 */
export function buildCustomTools(
  specs: ResolvedToolSpec[],
  callback: ToolCallbackContext | undefined,
): any[] {
  const tools: any[] = [];
  for (const spec of specs) {
    const base = {
      name: spec.name,
      label: spec.name,
      description: spec.description ?? spec.name,
      parameters: (spec.inputSchema as any) ?? EMPTY_OBJECT_SCHEMA,
    };
    if (spec.kind === "client") {
      log(
        `skipping client tool '${spec.name}' (browser-fulfilled; not available in-process)`,
      );
      continue;
    }
    if (spec.kind === "code") {
      tools.push({
        ...base,
        async execute(
          toolCallId: string,
          params: unknown,
          signal?: AbortSignal,
        ) {
          const text = await runResolvedTool(spec, params, {
            toolCallId,
            signal,
          });
          return {
            content: [{ type: "text", text }],
            details: { kind: "code" },
          };
        },
      });
      continue;
    }
    // callback (default): route back to Agenta's /tools/call.
    if (!callback?.endpoint) {
      log(
        `skipping callback tool '${spec.name}': missing toolCallback endpoint`,
      );
      continue;
    }
    tools.push({
      ...base,
      async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
        const text = await runResolvedTool(spec, params, {
          toolCallId,
          endpoint: callback.endpoint,
          authorization: callback.authorization,
          signal,
        });
        return {
          content: [{ type: "text", text }],
          details: { callRef: spec.callRef },
        };
      },
    });
  }
  return tools;
}

export async function runPi(
  request: AgentRunRequest,
  emit?: EmitEvent,
): Promise<AgentRunResult> {
  return withRequestProviderEnv(
    request.secrets,
    () => runPiWithEnv(request, emit),
    request.credentialMode,
  );
}

/**
 * The in-process Pi engine has no sandbox and runs tools directly (no relay), so it cannot honor
 * the capability layers the sandbox-agent engine enforces. Rather than silently ignore a
 * restrictive policy, fail loud and point at the enforcing backend. (Layer 1 Claude settings are
 * not checked here: Claude always runs over sandbox-agent, never this engine.)
 */
export function unenforceableCapabilityConfig(
  request: AgentRunRequest,
): string | undefined {
  const net = request.sandboxPermission?.network?.mode;
  if (net && net !== "on") {
    return `the in-process 'pi' backend cannot enforce sandbox_permission.network='${net}' (it has no sandbox); use the 'sandbox-agent' backend.`;
  }
  const fs = request.sandboxPermission?.filesystem;
  if (fs && fs !== "on") {
    return `the in-process 'pi' backend cannot enforce sandbox_permission.filesystem='${fs}'; use the 'sandbox-agent' backend.`;
  }
  const gated = (request.customTools as { name?: string; permission?: string }[] | undefined)
    ?.filter((t) => t?.permission === "deny" || t?.permission === "ask")
    .map((t) => t?.name ?? "?");
  if (gated && gated.length > 0) {
    return `the in-process 'pi' backend does not enforce tool permissions (deny/ask) for [${gated.join(", ")}]; use the 'sandbox-agent' backend.`;
  }
  return undefined;
}

async function runPiWithEnv(
  request: AgentRunRequest,
  emit?: EmitEvent,
): Promise<AgentRunResult> {
  const prompt = resolvePromptText(request);
  if (!prompt) {
    return {
      ok: false,
      error: "No user message to send (prompt/messages empty).",
    };
  }

  const unenforceable = unenforceableCapabilityConfig(request);
  if (unenforceable) {
    return { ok: false, error: `Capability config rejected: ${unenforceable}` };
  }

  const cwd = mkdtempSync(join(tmpdir(), "agenta-agent-"));
  // Removes the per-run skills temp root; assigned once skills materialize and always run in
  // the outer `finally`. No-op until then.
  let skillsCleanup: () => void = () => {};

  try {
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const available = await modelRegistry.getAvailable();
    if (!available || available.length === 0) {
      return {
        ok: false,
        error:
          "No model available. Log in with `pnpm exec pi` -> /login, or set OPENAI_API_KEY / ANTHROPIC_API_KEY.",
      };
    }

    // `request.model` is the resolved exact model (the Python wire sets it from the resolved
    // connection when one exists). The fallback chain in pickModel stays: model-config owns the
    // staged strict-fail rollout, this slice does not flip strict on.
    const model = pickModel(available, request.model);
    log(`model: ${model.provider}/${model.id}`);

    // A custom OpenAI-compatible base_url for in-process Pi (registerProvider / models.json
    // write into the agent dir) is OWNED by the model-config sibling project (Part 1) and not
    // landed here. Log it so a configured-but-not-applied endpoint is visible rather than
    // silently ignored. The Claude path applies ANTHROPIC_BASE_URL in the sandbox-agent engine.
    if (request.endpoint?.baseUrl) {
      log(
        `endpoint.baseUrl '${request.endpoint.baseUrl}' is not applied in-process yet ` +
          `(Pi custom-endpoint write is owned by the model-config project); ignoring for this run`,
      );
    }

    // Tracing: turn this run into OTel spans. When the caller passed a traceparent,
    // invoke_agent nests under their /invoke span so the whole agent run is part of the
    // same trace (just like completion/chat).
    const otel = createAgentaOtel({
      traceparent: request.trace?.traceparent,
      baggage: request.trace?.baggage,
      endpoint: request.trace?.endpoint,
      authorization: request.trace?.authorization,
      captureContent: request.trace?.captureContent,
    });

    // Inject AGENTS.md in memory and keep on-disk context files out of the run.
    const agentsMd = request.agentsMd?.trim();
    // Pi's two system-prompt layers, carried on the request (PiAgentConfig.system /
    // append_system). `systemPrompt` replaces Pi's base prompt; `appendSystemPrompt` adds to
    // it. We feed them through the loader overrides so the run stays hermetic: only what the
    // request carries applies, never a SYSTEM.md / APPEND_SYSTEM.md left on disk.
    const systemPrompt = request.systemPrompt?.trim();
    const appendSystemPrompt = request.appendSystemPrompt?.trim();
    // Skills: materialize each resolved inline package into a fresh dir and load exactly those.
    // `noSkills` suppresses host/global discovery so the run is deterministic; the loader still
    // merges `additionalSkillPaths` on top, so the materialized skills load. They only surface
    // in the prompt when `read` is enabled (the harness forces it). The temp root is removed in
    // the outer `finally` (skillsCleanup) on both success and error.
    const skillsResult = resolveSkillDirs(request.skills, log);
    const skills = skillsResult.skills;
    skillsCleanup = skillsResult.cleanup;
    if (skills.length > 0) {
      log(`skills: ${skills.map((s) => s.name).join(", ")}`);
    }
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      noContextFiles: true,
      noSkills: true,
      additionalSkillPaths: skills.map((s) => s.dir),
      systemPromptOverride: () => systemPrompt || undefined,
      appendSystemPromptOverride: () =>
        appendSystemPrompt ? [appendSystemPrompt] : [],
      agentsFilesOverride: () => ({
        agentsFiles: agentsMd
          ? [{ path: "/virtual/AGENTS.md", content: agentsMd }]
          : [],
      }),
      extensionFactories: [otel.register],
    });
    await loader.reload();

    // Build runnable tools from the resolved specs. Pi's allowlist gates custom tools too,
    // so their names must be in `tools` for the model to see them.
    const customTools = buildCustomTools(
      request.customTools ?? [],
      request.toolCallback,
    );
    const toolAllowlist = [
      ...(request.tools ?? []),
      ...customTools.map((tool) => tool.name),
    ];
    if (customTools.length > 0) {
      log(`custom tools: ${customTools.map((t) => t.name).join(", ")}`);
    }

    // Created before the prompt so a throw mid-run still flushes the partial trace and
    // disposes the session (the inner finally below). Mirrors the sandbox-agent engine's pattern.
    let session:
      | Awaited<ReturnType<typeof createAgentSession>>["session"]
      | undefined;
    try {
      ({ session } = await createAgentSession({
        cwd,
        model,
        authStorage,
        modelRegistry,
        tools: toolAllowlist,
        customTools,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager: SettingsManager.inMemory(),
        resourceLoader: loader,
      }));

      // Hand the session id + model to the extension so spans carry them.
      const sessionId = resolveRunSessionId(request, session.sessionId);
      otel.config.sessionId = sessionId;
      otel.config.provider = model.provider;
      otel.config.requestModel = model.id;

      // Accumulate streamed text as the primary output channel. On the streaming path, flush
      // each Pi `text_delta` as a `message_delta` live (Pi deltas are already pure, so they
      // emit verbatim); the block opens on the first delta and closes after the run.
      let streamed = "";
      let piTextId: string | undefined;
      session.subscribe((event: any) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        ) {
          const delta = event.assistantMessageEvent.delta ?? "";
          if (!delta) return;
          streamed += delta;
          if (emit) {
            if (piTextId === undefined) {
              piTextId = "msg-0";
              emit({ type: "message_start", id: piTextId });
            }
            emit({ type: "message_delta", id: piTextId, delta });
          }
        }
      });

      await session.prompt(prompt);

      const output = streamed.trim() || extractAssistantText(session.messages);
      const stopReason = lastStopReason(session.messages);
      const usage = otel.usage();

      // Ship this run's trace before the result is returned (and before the CLI process
      // exits): invoke_agent has a remote parent, so the per-trace flush is what exports it.
      await otel.flush();

      // The structured stream is thinner here than on the sandbox-agent path: Pi's in-process tool
      // events feed the trace spans, while the result-level event log carries the final
      // message, usage, and stop reason (enough for the platform without double-plumbing).
      //
      // On the streaming path the events were flushed live via `emit`, so the result log stays
      // empty; here we only close the open text block (or synthesize one when the text never
      // streamed) and flush the tail usage/done events.
      const events: AgentEvent[] = [];
      const emitOrLog = (event: AgentEvent): void => {
        if (emit) emit(event);
        else events.push(event);
      };
      if (emit) {
        if (piTextId !== undefined) {
          emit({ type: "message_end", id: piTextId });
        } else if (output) {
          emit({ type: "message_start", id: "msg-0" });
          emit({ type: "message_delta", id: "msg-0", delta: output });
          emit({ type: "message_end", id: "msg-0" });
        }
      } else if (output) {
        events.push({ type: "message", text: output });
      }
      if (usage.total > 0) emitOrLog({ type: "usage", ...usage });
      emitOrLog({ type: "done", stopReason });

      const messages: ChatMessage[] = output
        ? [{ role: "assistant", content: output }]
        : [];

      return {
        ok: true,
        output,
        messages,
        events,
        usage,
        stopReason,
        // `streamingDeltas` is only honest when a live sink carried the deltas end-to-end.
        capabilities: { ...PI_CAPABILITIES, streamingDeltas: !!emit },
        sessionId,
        model: `${model.provider}/${model.id}`,
        traceId: otel.config.traceId,
      };
    } catch (err) {
      // Flush the partial trace before the error propagates so a failed run is still
      // observable (the happy-path flush above never ran). Best-effort: never mask `err`.
      await otel.flush().catch(() => {});
      throw err;
    } finally {
      // Pi keeps the in-memory session alive until disposed; release it on every exit
      // (success or throw). Guarded for the case where createAgentSession itself threw.
      session?.dispose();
    }
  } finally {
    skillsCleanup();
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of the throwaway working dir
    }
  }
}
