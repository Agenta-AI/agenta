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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import { callAgentaTool } from "./callback.ts";
import { runCodeTool } from "./code.ts";
import {
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
import type { GateDescriptor, Verdict } from "../permission-plan.ts";
import type { ClientToolOutcome } from "../responder.ts";
import { assertRequiredArguments } from "./spec-schema.ts";

export const RELAY_REQ_SUFFIX = ".req.json";
export const RELAY_RES_SUFFIX = ".res.json";
export const RELAY_POLL_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_POLLING ?? 300,
);
export const RELAY_TIMEOUT_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_TIMEOUT ?? 60000,
);

export interface RelayRequest {
  toolName: string;
  toolCallId: string;
  args: unknown;
}
export interface RelayResponse {
  ok: boolean;
  text?: string;
  error?: string;
}
export interface ClientToolRelayRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  spec: ResolvedToolSpec;
}
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
  }) => void;
}

export interface ClientToolRelay {
  onClientTool: (request: ClientToolRelayRequest) => Promise<ClientToolOutcome>;
  onPause?: (request: ClientToolRelayRequest) => void;
}
const PAUSED = Symbol("paused");

/** Make a tool-call id safe to use as a filename (and bounded). */
export function sanitizeRelayId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "tool";
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));


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
      return typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
    },
    write: async (path, contents) => {
      await sandbox.writeFsFile({ path }, contents);
    },
  };
}

async function executeRelayedTool(
  spec: ResolvedToolSpec,
  req: RelayRequest,
  callback: ToolCallbackContext | undefined,
  permissions: RelayPermissions,
  runContext: RunContext | undefined,
  clientToolRelay: ClientToolRelay | undefined,
): Promise<string | typeof PAUSED> {
  if (spec.kind === "client") {
    assertRequiredArguments(spec, req.args);
    if (!clientToolRelay) {
      throw new Error(`client tool '${spec.name}' is browser-fulfilled and cannot be executed`);
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
        return `Tool '${spec.name}' is denied by policy.`;
      }
      return `Tool '${spec.name}' is denied by the permission policy.`;
    }
    if (verdict.kind === "pendingApproval") {
      permissions.onPendingApproval({
        toolCallId: req.toolCallId,
        toolName: spec.name,
        args: req.args,
      });
      return PAUSED;
    }
  }

  return executeAllowedRelayedTool(spec, req, callback, runContext);
}

async function executeAllowedRelayedTool(
  spec: ResolvedToolSpec,
  req: RelayRequest,
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
    return callDirect(spec.call.method, url, callback.authorization, body);
  }
  // Gateway (Composio): POST back through Agenta's /tools/call so the secret stays server-side.
  return callAgentaTool(
    callback.endpoint,
    callback.authorization,
    spec.callRef ?? "",
    req.toolCallId,
    req.args,
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
        permissions,
        runContext,
        clientToolRelay,
      );
      if (text === PAUSED) return;
      res = { ok: true, text };
    } catch (err) {
      res = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    try {
      await host.write(`${relayDir}/${id}${RELAY_RES_SUFFIX}`, JSON.stringify(res));
    } catch {
      // The extension will time out and surface a tool error; nothing else to do here.
    }
  };

  const loop = (async () => {
    while (active) {
      try {
        const names = await host.list(relayDir);
        for (const name of names) {
          if (!name.endsWith(RELAY_REQ_SUFFIX) || seen.has(name)) continue;
          seen.add(name);
          inflight.push(handle(name));
        }
      } catch {
        // Transient (dir not created yet, or a poll raced sandbox teardown): retry.
      }
      await sleep(RELAY_POLL_MS);
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
