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
import { runCodeTool } from "./code.ts";
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
import {
  piBuiltinIdentity,
  type GateDescriptor,
  type Verdict,
} from "../permission-plan.ts";
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
export const RELAY_PERMISSION_PROTOCOL = 1;

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
export interface PermissionRelayRequest {
  kind: "permission";
  protocol: typeof RELAY_PERMISSION_PROTOCOL;
  toolName: string;
  toolCallId: string;
  args: unknown;
}
export type RelayRequest = ExecuteRelayRequest | PermissionRelayRequest;

export interface ExecuteRelayResponse {
  kind?: "execute";
  ok: boolean;
  text?: string;
  error?: string;
}
export type RelayResponse = ExecuteRelayResponse;
export type PermissionRelayVerdict = "allow" | "deny" | "pendingApproval";
export interface PermissionRelayResponse {
  kind: "permission";
  ok: boolean;
  verdict: PermissionRelayVerdict;
  reason?: string;
}
export type RelayRecordResponse =
  ExecuteRelayResponse | PermissionRelayResponse;
export interface RelayPermissions {
  /** False when the harness raises its own gates first (Claude); the relay then executes
   *  what reaches it. True when the relay is the only gate (Pi). */
  enforce: boolean;
  decide: (gate: GateDescriptor) => Verdict;
  /** Called when an ask pauses at the relay: emit the approval event and pause the turn. */
  onPendingApproval: (info: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }) => { emitted: boolean };
}
const PAUSED = Symbol("paused");

/** Make a tool-call id safe to use as a filename (and bounded). */
export function sanitizeRelayId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "tool";
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export function parsePermissionRelayResponse(
  value: unknown,
): PermissionRelayResponse | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== "permission") return undefined;
  if (typeof value.ok !== "boolean") return undefined;
  if (!isPermissionRelayVerdict(value.verdict)) return undefined;
  if (value.reason !== undefined && typeof value.reason !== "string") {
    return undefined;
  }
  return {
    kind: "permission",
    ok: value.ok,
    verdict: value.verdict,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  };
}

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

async function executeRelayedTool(
  spec: ResolvedToolSpec,
  req: ExecuteRelayRequest,
  callback: ToolCallbackContext | undefined,
  permissions: RelayPermissions,
  runContext: RunContext | undefined,
  clientToolRelay: ClientToolRelay | undefined,
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

  if (permissions.enforce) {
    const gate: GateDescriptor = {
      executor: "relay",
      toolName: spec.name,
      specPermission: spec.permission,
      readOnlyHint: spec.readOnly,
      args: req.args,
    };
    const verdict = permissions.decide(gate);
    if (verdict.kind === "deny") {
      if (spec.permission === "deny") {
        return authoredDenyReason(spec.name);
      }
      return permissionPolicyDenyReason(spec.name);
    }
    if (verdict.kind === "pendingApproval") {
      // Pi file-relay approvals are recorded here. Claude's approval card is
      // harness-rendered before this point, so this relay cannot redact it.
      permissions.onPendingApproval({
        toolCallId: req.toolCallId,
        toolName: spec.name,
        args: pendingApprovalArgs(spec, req.args),
      });
      return PAUSED;
    }
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
    return runCodeTool(spec.runtime, spec.code ?? "", spec.env, req.args);
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
function permissionPolicyDenyReason(toolName: string): string {
  return `Tool '${toolName}' is denied by the permission policy.`;
}

function authoredDenyReason(toolName: string): string {
  return `Tool '${toolName}' is denied by policy.`;
}

function permissionProtocolMismatchReason(): string {
  return "Permission check denied because of a runner/extension version mismatch.";
}

function logPermissionRelayError(message: string): void {
  process.stderr.write(`[tool-relay] ERROR ${message}\n`);
}

function permissionDenyResponse(reason: string): PermissionRelayResponse {
  return { kind: "permission", ok: true, verdict: "deny", reason };
}

function isPermissionRelayVerdict(
  value: unknown,
): value is PermissionRelayVerdict {
  return value === "allow" || value === "deny" || value === "pendingApproval";
}

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

function pruneEmptyAncestors(target: Record<string, unknown>, path: string): void {
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

function pendingApprovalArgs(
  spec: ResolvedToolSpec,
  args: unknown,
): unknown {
  if (!spec.callRef || !spec.contextBindings || !isRecord(args)) return args;
  const displayArgs = cloneJsonish(args);
  if (!isRecord(displayArgs)) return displayArgs;
  for (const path of Object.keys(spec.contextBindings)) {
    deepDelete(displayArgs, path);
    pruneEmptyAncestors(displayArgs, path);
  }
  return displayArgs;
}

async function handlePermissionRelayRequest(
  req: Partial<PermissionRelayRequest> & {
    kind: "permission";
    protocol?: unknown;
  },
  fallbackId: string,
  permissions: RelayPermissions,
): Promise<PermissionRelayResponse> {
  const toolName =
    typeof req.toolName === "string" ? req.toolName : "<unknown>";
  if (req.protocol !== RELAY_PERMISSION_PROTOCOL) {
    logPermissionRelayError(
      `permission protocol mismatch for ${toolName}: got ${JSON.stringify(
        req.protocol,
      )}, expected ${RELAY_PERMISSION_PROTOCOL}; denying`,
    );
    return permissionDenyResponse(permissionProtocolMismatchReason());
  }

  const identity = piBuiltinIdentity(toolName);
  if (!identity) {
    logPermissionRelayError(
      `unknown builtin permission tool ${toolName}; denying`,
    );
    return permissionDenyResponse(permissionPolicyDenyReason(toolName));
  }

  const gate: GateDescriptor = {
    executor: "harness",
    toolName: identity.ruleName,
    readOnlyHint: identity.readOnly,
    args: req.args,
  };
  const verdict = permissions.decide(gate);
  if (verdict.kind === "allow") {
    return { kind: "permission", ok: true, verdict: "allow" };
  }
  if (verdict.kind === "deny") {
    return permissionDenyResponse(permissionPolicyDenyReason(toolName));
  }

  const pending = permissions.onPendingApproval({
    toolCallId:
      typeof req.toolCallId === "string" ? req.toolCallId : fallbackId,
    toolName,
    args: req.args,
  });
  return {
    kind: "permission",
    ok: true,
    verdict: "pendingApproval",
    reason: pending.emitted
      ? `Waiting for approval of ${toolName}.`
      : "Another approval is pending; retry after it resolves.",
  };
}

export function startToolRelay(
  host: RelayHost,
  relayDir: string,
  specs: ResolvedToolSpec[],
  callback: ToolCallbackContext | undefined,
  permissions: RelayPermissions,
  runContext?: RunContext,
  clientToolRelay?: ClientToolRelay,
): { stop: () => Promise<void> } {
  let active = true;
  const seen = new Set<string>();
  const inflight: Promise<void>[] = [];
  const specsByName = new Map(specs.map((spec) => [spec.name, spec]));

  const handle = async (reqName: string): Promise<void> => {
    const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
    let res: RelayRecordResponse;
    let permissionReqName: string | undefined;
    try {
      const raw = await host.read(`${relayDir}/${reqName}`);
      const req = JSON.parse(raw) as RelayRequest;
      if (req.kind === "permission") {
        permissionReqName =
          typeof req.toolName === "string" ? req.toolName : undefined;
        res = await handlePermissionRelayRequest(req, id, permissions);
      } else {
        const spec = specsByName.get(req.toolName);
        if (!spec) throw new Error(`unknown tool '${req.toolName}'`);
        const text = await executeRelayedTool(
          spec,
          { ...req, toolCallId: req.toolCallId ?? id },
          callback,
          permissions,
          runContext,
          clientToolRelay,
        );
        if (text === PAUSED) return;
        res = { ok: true, text };
      }
    } catch (err) {
      if (permissionReqName !== undefined) {
        logPermissionRelayError(
          `permission request for ${permissionReqName} failed: ${
            err instanceof Error ? err.message : String(err)
          }; denying`,
        );
        res = permissionDenyResponse(
          permissionPolicyDenyReason(permissionReqName),
        );
      } else {
        res = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
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
