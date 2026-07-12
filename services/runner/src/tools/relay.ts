/**
 * Daytona tool relay — the RUNNER side.
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
 *
 * The relay is split across three modules: the bundle-safe wire protocol (suffixes,
 * request/response shapes, serialization, shared timing) lives in `relay-protocol.ts`;
 * the in-sandbox writer client lives in `relay-client.ts`; this module keeps the
 * runner-side consumer/executor loop. The protocol pieces are re-exported below so
 * existing importers keep compiling.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
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
import {
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  relayTempPath,
  sleep,
  type ExecuteRelayRequest,
  type RelayRequest,
  type RelayResponse,
} from "./relay-protocol.ts";
import {
  RELAY_SAFETY_POLL_MS,
  daytonaRelayActivitySource,
  localRelayActivitySource,
  remoteWatchEnabled,
  type RelayActivitySource,
} from "./relay-watch.ts";
import { assertRequiredArguments } from "./spec-schema.ts";

// Compatibility re-export: the type moved to `client-tool-relay.ts` (a pure type module);
// importers that still reach it through this module keep working while they migrate.
export type {
  ClientToolRelay,
  ClientToolRelayRequest,
} from "./client-tool-relay.ts";

// Compatibility re-export: the wire protocol moved to `relay-protocol.ts` (bundle-safe,
// shared with the in-sandbox writer); importers that still reach it through this module
// keep working while they migrate.
export {
  RELAY_POLL_MS,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  RELAY_TIMEOUT_MS,
  sanitizeRelayId,
  sleep,
} from "./relay-protocol.ts";
export type {
  ExecuteRelayRequest,
  ExecuteRelayResponse,
  RelayRequest,
  RelayResponse,
} from "./relay-protocol.ts";
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

export interface RelayHost {
  list: (dir: string) => Promise<string[]>;
  read: (path: string) => Promise<string>;
  write: (path: string, contents: string) => Promise<void>;
  /**
   * Atomically publish a fully written file under its final name (plan decision 2):
   * the response is written to a `relayTempPath` name first and this rename makes it
   * visible, so the in-sandbox writer can never read partial JSON.
   */
  rename: (from: string, to: string) => Promise<void>;
  /**
   * Delete one relay file. Used for delete-on-pickup: the runner removes a request
   * file as soon as it has read it, so a watch that wakes on ANY `*.req.json` present
   * (the Daytona watch exec) does not insta-complete and rearm for the whole
   * execution. Call sites guard with their own try/catch (pickup removal is
   * best-effort); implementations may throw.
   */
  remove: (path: string) => Promise<void>;
  /**
   * Optional hop 2 wake source for the relay dir (plan decision 3). Undefined means
   * the loop is byte-for-byte today's poll loop. A source that suspends polling
   * (Daytona watch exec) replaces the remote poll with the 30 s safety poll while
   * healthy; one that does not (local fs.watch) only shortens the poll sleep.
   */
  createActivitySource?: (dir: string) => RelayActivitySource | undefined;
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
    rename: async (from, to) => {
      renameSync(from, to);
    },
    remove: async (path) => {
      unlinkSync(path);
    },
    // Unflagged (plan decision 7, last paragraph): the local watch's failure mode is
    // "fall back to the poll" and the poll cadence is unchanged either way.
    createActivitySource: (dir) => localRelayActivitySource(dir),
  };
}

/** Relay host for child processes running inside a Daytona sandbox. */
export function sandboxRelayHost(
  sandbox: any,
  opts?: { log?: (msg: string) => void },
): RelayHost {
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
    rename: async (from, to) => {
      // Verified against the daemon source (v0.4.2 router.rs): /v1/fs/move is Rust
      // std::fs::rename, i.e. rename(2), atomic for a same-directory move (plan open
      // question 2 resolved). `overwrite: true` only guards a pathological duplicate
      // response; the final name never pre-exists in normal operation.
      await sandbox.moveFs({ from, to, overwrite: true });
    },
    remove: async (path) => {
      await sandbox.deleteFsEntry({ path });
    },
    // Flagged (plan decision 7): the remote watch changes what the runner asks the
    // daemon to do, so it ships behind AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED
    // (default false). Off means today's poll loop, byte for byte.
    createActivitySource: (dir) =>
      remoteWatchEnabled()
        ? daytonaRelayActivitySource(sandbox, dir, { log: opts?.log })
        : undefined,
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
      const reqPath = `${relayDir}/${reqName}`;
      const raw = await host.read(reqPath);
      // Delete-on-pickup: remove the request file BEFORE executing. The Daytona watch
      // exec wakes on ANY *.req.json present, so a request left on disk for the whole
      // execution would make every window insta-complete and rearm at network speed
      // (~66 daemon req/s measured). The `seen` set still dedups the list race. This
      // deliberately ends crash-redelivery-by-re-listing — a request is executed at
      // most once per publication, consistent with the orphan-residue decision (a
      // restarted turn must not re-execute stale requests; the writer times out and
      // surfaces a tool error instead).
      try {
        await host.remove(reqPath);
      } catch {
        // Best-effort: a failed removal only costs extra wakes, never correctness.
      }
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
      // Atomic publication (plan decision 2): full bytes under a temp name, then a
      // same-directory rename to the final name the in-sandbox writer waits on.
      const finalResPath = `${relayDir}/${id}${RELAY_RES_SUFFIX}`;
      const tmpResPath = relayTempPath(finalResPath);
      await host.write(tmpResPath, JSON.stringify(res));
      await host.rename(tmpResPath, finalResPath);
    } catch {
      // The extension will time out and surface a tool error; nothing else to do here.
    }
  };

  // Hop 2 wake source (plan decision 3). Undefined (no capability, or the remote watch
  // flag is off, or fs.watch failed) leaves the loop below byte-for-byte today's poll.
  const source = host.createActivitySource?.(relayDir);

  const loop = (async () => {
    // Idle-poll backoff: a quiet turn (e.g. waiting on a browser-fulfilled client-tool pause)
    // grows the delay up to RELAY_POLL_MAX_MS instead of polling at 300 ms forever; any new
    // request resets it. This cuts the remote `ls` rate on Daytona without delaying a real call.
    let idlePolls = 0;
    let lastWaitOutcome: "activity" | "timeout" | "closed" | undefined;
    try {
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
        // A safety-poll ("timeout") wake that FOUND work while the suspended watch
        // claimed healthy is a watch miss (plan decision 4): it feeds demotion.
        if (
          sawNew &&
          source?.suspendsPolling &&
          source.isHealthy() &&
          lastWaitOutcome === "timeout"
        ) {
          source.noteMiss?.();
        }
        idlePolls = sawNew ? 0 : idlePolls + 1;
        if (source && source.isHealthy() && source.suspendsPolling) {
          // Healthy remote watch: the watch exec's completion is the wake; the remote
          // poll is suspended and only the 30 s safety poll remains (plan decision 6).
          lastWaitOutcome = await source.wait({
            timeoutMs: RELAY_SAFETY_POLL_MS,
          });
        } else if (source && source.isHealthy()) {
          // Local watch: shortens the sleep only; the poll cadence is unchanged.
          lastWaitOutcome = await source.wait({
            timeoutMs: relayPollDelayMs(idlePolls),
          });
        } else {
          // Classic loop, byte for byte (no source, demoted, or closed).
          await sleep(relayPollDelayMs(idlePolls));
          lastWaitOutcome = undefined;
        }
      }
    } finally {
      // No timer or watcher may outlive the loop, however it exits.
      source?.close();
    }
    await Promise.allSettled(inflight);
  })();

  return {
    stop: async () => {
      active = false;
      // Close before awaiting the loop so a held 30 s safety-poll wait resolves
      // ("closed") immediately instead of pinning stop() on its timer.
      source?.close();
      await loop.catch(() => {});
    },
  };
}
