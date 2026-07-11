/**
 * Daytona tool relay.
 *
 * Tool child processes do not receive private resolved specs, executable code, scoped env,
 * callback endpoints, or callback auth. They receive only public tool metadata plus this
 * relay directory, then ask the runner to execute each call.
 *
 * The runner CAN reach Agenta (it resolved the tools and holds the callback), and it can
 * reach the sandbox filesystem over the daemon API. So tool calls are relayed through the
 * runner via files in a sandbox dir:
 *
 *   child:  write `<id>.req.json` {toolName, args} ──▶ poll `<id>.res.json`
 *   runner: poll the dir, read `<id>.req.json` ──▶ execute private spec in memory
 *           ──▶ write `<id>.res.json`
 *
 * The same loop supports local filesystem relays and Daytona sandbox filesystem relays.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import { callAgentaTool } from "./callback.ts";
import { CODE_TOOL_UNSUPPORTED_MESSAGE } from "./code.ts";
import {
  applyContextBindings,
  assembleBody,
  callDirect,
  deepDelete,
  directCallUrl,
  pathParamNames,
} from "./direct.ts";
import type {
  ResolvedToolSpec,
  RunContext,
  ToolCallbackContext,
} from "../protocol.ts";
import type { ClientToolRelay } from "./client-tool-relay.ts";
import { assertRequiredArguments } from "./spec-schema.ts";

// Compatibility re-export: the type moved to `client-tool-relay.ts` (a pure type module);
// importers that still reach it through this module keep working while they migrate.
export type {
  ClientToolRelay,
  ClientToolRelayRequest,
} from "./client-tool-relay.ts";

export const RELAY_REQ_SUFFIX = ".req.json";
export const RELAY_RES_SUFFIX = ".res.json";
export const RELAY_POLL_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_POLLING ?? 300,
);
export const RELAY_TIMEOUT_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_TIMEOUT ?? 60000,
);
/**
 * Idle-backoff cap for the runner relay poll. The loop polls `host.list(relayDir)` every
 * `RELAY_POLL_MS` (300 ms) for the whole turn — on Daytona that `list` is a remote `ls` exec
 * (~3×/s), now also for client-only runs that wait on a browser-fulfilled pause and produce no
 * other tool traffic. After `RELAY_POLL_IDLE_GROW_AFTER` consecutive idle polls the delay grows
 * geometrically up to this cap, so a quiet turn settles to ~1.5 s polls; the moment a request
 * file appears the delay resets to `RELAY_POLL_MS`, so a real tool call is still picked up
 * promptly.
 */
export const RELAY_POLL_MAX_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_POLLING_MAX ?? 1500,
);
export const RELAY_POLL_IDLE_GROW_AFTER = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_IDLE_GROW_AFTER ?? 5,
);

/** The next poll delay given the count of consecutive idle polls (no new request seen). */
export function relayPollDelayMs(idlePolls: number): number {
  if (idlePolls < RELAY_POLL_IDLE_GROW_AFTER) return RELAY_POLL_MS;
  const factor = 2 ** (idlePolls - RELAY_POLL_IDLE_GROW_AFTER + 1);
  return Math.min(RELAY_POLL_MS * factor, RELAY_POLL_MAX_MS);
}

export interface ExecuteRelayRequest {
  kind?: "execute";
  toolName: string;
  toolCallId: string;
  args: unknown;
}
export type RelayRequest = ExecuteRelayRequest;

export interface ExecuteRelayResponse {
  kind?: "execute";
  ok: boolean;
  text?: string;
  error?: string;
}
export type RelayResponse = ExecuteRelayResponse;
const PAUSED = Symbol("paused");

/**
 * Runner-side authorization for one relay execute record. The relay dir is sandbox-writable,
 * so a record can be forged without ever passing the in-sandbox approval dialog; this re-check
 * is the runner-side enforcement the dialog cannot provide. The deny reason becomes the tool's
 * result text, so the model loop continues (same shape as a dialog deny).
 */
export type RelayExecutionGuard = (
  spec: ResolvedToolSpec,
  req: ExecuteRelayRequest,
) => { allow: true } | { allow: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneJsonish(item));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = cloneJsonish(item);
  }
  return out;
}

function pruneEmptyAncestors(
  target: Record<string, unknown>,
  path: string,
): void {
  const parts = path.split(".");
  const ancestors: Array<{ owner: Record<string, unknown>; key: string }> = [];
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!isRecord(next)) return;
    ancestors.push({ owner: cursor, key: part });
    cursor = next;
  }
  for (const { owner, key } of ancestors.reverse()) {
    const value = owner[key];
    if (!isRecord(value) || Object.keys(value).length > 0) return;
    delete owner[key];
  }
}

/**
 * Strip context-bound argument paths from a tool call's args. Bound paths are overwritten from
 * runContext at execution, so approval display and stored-decision keys must not include the
 * model's values for them: a card would show a value that never executes, and a decision keyed
 * on it would not match the same call re-keyed after redaction. Empty ancestor objects left by
 * a deleted path are pruned so the redacted shape is canonical.
 */
export function redactContextBoundArgs(
  args: unknown,
  contextBindings: Record<string, string> | undefined,
): unknown {
  if (!contextBindings || Object.keys(contextBindings).length === 0)
    return args;
  if (!isRecord(args)) return args;
  const redacted = cloneJsonish(args);
  if (!isRecord(redacted)) return redacted;
  for (const path of Object.keys(contextBindings)) {
    deepDelete(redacted, path);
    pruneEmptyAncestors(redacted, path);
  }
  return redacted;
}

/** Make a tool-call id safe to use as a filename (and bounded). */
export function sanitizeRelayId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "tool";
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface RelayHost {
  list: (dir: string) => Promise<string[]>;
  read: (path: string) => Promise<string>;
  write: (path: string, contents: string) => Promise<void>;
}

/** Relay host for child processes running on the same filesystem as the runner. */
export function localRelayHost(): RelayHost {
  return {
    list: async (dir) => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir);
    },
    read: async (path) => readFileSync(path, "utf-8"),
    write: async (path, contents) => {
      mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      writeFileSync(path, contents, "utf-8");
    },
  };
}

/** Relay host for child processes running inside a Daytona sandbox. */
export function sandboxRelayHost(sandbox: any): RelayHost {
  return {
    list: async (dir) => {
      const ls = await sandbox.runProcess({
        command: "ls",
        args: ["-1", dir],
        timeoutMs: 10_000,
      });
      return String(ls?.stdout ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    },
    read: async (path) => {
      const bytes = await sandbox.readFsFile({ path });
      return typeof bytes === "string"
        ? bytes
        : new TextDecoder().decode(bytes);
    },
    write: async (path, contents) => {
      await sandbox.writeFsFile({ path }, contents);
    },
  };
}

// The relay carries EXECUTION only. Permission gates never ride these files: Claude raises its
// own ACP gates before a call reaches the relay, and a Pi gate rides the extension's
// `ctx.ui.confirm` dialog onto the ACP permission plane (Pi approval parking), decided and
// parked by the runner's permission responder before the extension writes an execute request.
async function executeRelayedTool(
  spec: ResolvedToolSpec,
  req: ExecuteRelayRequest,
  callback: ToolCallbackContext | undefined,
  runContext: RunContext | undefined,
  clientToolRelay: ClientToolRelay | undefined,
  guard: RelayExecutionGuard | undefined,
): Promise<string | typeof PAUSED> {
  if (spec.kind === "client") {
    assertRequiredArguments(spec, req.args);
    if (!clientToolRelay) {
      throw new Error(
        `client tool '${spec.name}' is browser-fulfilled and cannot be executed`,
      );
    }
    const toolCallId = req.toolCallId;
    const request = {
      id: toolCallId,
      toolCallId,
      toolName: spec.name,
      input: req.args,
      spec,
    };
    const decision = await clientToolRelay.onClientTool(request);
    if (decision === "pendingApproval") {
      clientToolRelay.onPause?.(request);
      return PAUSED;
    }
    if (decision === "deny") {
      return `Client tool '${spec.name}' was denied.`;
    }
    return JSON.stringify(decision.output ?? {});
  }

  // Client tools keep their own browser-fulfilled pause semantics above; everything else is
  // re-checked here because the request file is sandbox-writable and proves nothing about the
  // dialog gate having run.
  if (guard) {
    const verdict = guard(spec, req);
    if (!verdict.allow) return verdict.reason;
  }

  return executeAllowedRelayedTool(spec, req, callback, runContext);
}

async function executeAllowedRelayedTool(
  spec: ResolvedToolSpec,
  req: ExecuteRelayRequest,
  callback: ToolCallbackContext | undefined,
  runContext: RunContext | undefined,
): Promise<string> {
  assertRequiredArguments(spec, req.args);
  if (spec.kind === "code") {
    // Code execution was removed (F-010). Refused up front in `buildRunPlan`; this inline throw
    // is the defense-in-depth backstop so a code spec reaching the relay fails loud (F-016).
    throw new Error(CODE_TOOL_UNSUPPORTED_MESSAGE);
  }
  if (!callback?.endpoint) {
    throw new Error(`missing toolCallback endpoint for '${spec.name}'`);
  }
  // Direct-call tools (reference / platform): the host makes the call directly so the sandbox
  // child still sends only name + args. The origin is bound to the run's own callback endpoint
  // and the run's authorization is reused (see tools/direct.ts). A spec carries `call` XOR
  // `callRef`, so this is checked before the gateway fallback. `runContext` fills the
  // `call.context` bindings server-side (direct-call tools, Phase 3a), hidden from the model.
  if (spec.call) {
    const body = assembleBody(spec.call, req.args, runContext);
    const url = directCallUrl(callback.endpoint, spec.call, body);
    // Path params were just substituted into the URL from this same body; strip them so a
    // POST handler whose request model expects the identifier only in the route (e.g.
    // `/api/triggers/schedules/{id}/stop`) does not also receive `id` in the JSON payload.
    for (const name of pathParamNames(spec.call.path)) {
      deepDelete(body, name);
    }
    return callDirect(spec.call.method, url, callback.authorization, body, {
      runKind: runContext?.run?.kind,
    });
  }
  // Gateway (Composio): POST back through Agenta's /tools/call so the secret stays server-side.
  const args = spec.contextBindings
    ? applyContextBindings(req.args, spec.contextBindings, runContext)
    : req.args;
  return callAgentaTool(
    callback.endpoint,
    callback.authorization,
    spec.callRef ?? "",
    req.toolCallId,
    args,
    { timeoutMs: spec.timeoutMs, runKind: runContext?.run?.kind },
  );
}

/**
 * Runner-side relay loop. Polls the sandbox relay dir for request files, executes each
 * against the private spec in memory, and writes the response file
 * the in-sandbox extension is waiting on. Returns `stop()` to end the loop and drain any
 * in-flight executions; call it once the prompt resolves.
 */
export function startToolRelay(
  host: RelayHost,
  relayDir: string,
  specs: ResolvedToolSpec[],
  callback: ToolCallbackContext | undefined,
  runContext?: RunContext,
  clientToolRelay?: ClientToolRelay,
  guard?: RelayExecutionGuard,
): { stop: () => Promise<void> } {
  let active = true;
  const seen = new Set<string>();
  const inflight: Promise<void>[] = [];
  const specsByName = new Map(specs.map((spec) => [spec.name, spec]));

  const handle = async (reqName: string): Promise<void> => {
    const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
    let res: RelayResponse;
    try {
      const raw = await host.read(`${relayDir}/${reqName}`);
      const req = JSON.parse(raw) as RelayRequest;
      const spec = specsByName.get(req.toolName);
      if (!spec) throw new Error(`unknown tool '${req.toolName}'`);
      const text = await executeRelayedTool(
        spec,
        { ...req, toolCallId: req.toolCallId ?? id },
        callback,
        runContext,
        clientToolRelay,
        guard,
      );
      if (text === PAUSED) return;
      res = { ok: true, text };
    } catch (err) {
      res = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      await host.write(
        `${relayDir}/${id}${RELAY_RES_SUFFIX}`,
        JSON.stringify(res),
      );
    } catch {
      // The extension will time out and surface a tool error; nothing else to do here.
    }
  };

  const loop = (async () => {
    // Idle-poll backoff: a quiet turn (e.g. waiting on a browser-fulfilled client-tool pause)
    // grows the delay up to RELAY_POLL_MAX_MS instead of polling at 300 ms forever; any new
    // request resets it. This cuts the remote `ls` rate on Daytona without delaying a real call.
    let idlePolls = 0;
    while (active) {
      let sawNew = false;
      try {
        const names = await host.list(relayDir);
        for (const name of names) {
          if (!name.endsWith(RELAY_REQ_SUFFIX) || seen.has(name)) continue;
          seen.add(name);
          sawNew = true;
          inflight.push(handle(name));
        }
      } catch {
        // Transient (dir not created yet, or a poll raced sandbox teardown): retry.
      }
      idlePolls = sawNew ? 0 : idlePolls + 1;
      await sleep(relayPollDelayMs(idlePolls));
    }
    await Promise.allSettled(inflight);
  })();

  return {
    stop: async () => {
      active = false;
      await loop.catch(() => {});
    },
  };
}
