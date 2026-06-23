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
import type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";
import type { PermissionPolicy } from "../responder.ts";

export const RELAY_REQ_SUFFIX = ".req.json";
export const RELAY_RES_SUFFIX = ".res.json";
export const RELAY_POLL_MS = Number(process.env.AGENTA_TOOL_RELAY_POLL_MS ?? 300);
export const RELAY_TIMEOUT_MS = Number(process.env.AGENTA_TOOL_RELAY_TIMEOUT_MS ?? 60000);

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

/** Make a tool-call id safe to use as a filename (and bounded). */
export function sanitizeRelayId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "tool";
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Layer 3 enforcement (S3b): resolve a resolved-tool spec's `disposition` to a concrete
 * runner-side decision. `allow` runs, `deny` never runs; `ask` and an UNSET disposition
 * degrade to the run's headless `permissionPolicy` (`auto` -> allow, `deny` -> deny).
 *
 * Resolved tools (code / gateway-callback) run runner-side via the relay, harness-agnostic, so
 * this is where their disposition is enforced (Claude builtins are enforced at Layer 1 via
 * .claude/settings.json instead). Surfacing an `ask` to a live human is the cross-turn HITL
 * path (S5); here `ask` is a headless run, so it collapses onto the policy.
 */
export function resolveDisposition(
  disposition: string | undefined,
  policy: PermissionPolicy,
): "allow" | "deny" {
  if (disposition === "allow") return "allow";
  if (disposition === "deny") return "deny";
  // `ask` or unset: headless, so defer to the run policy.
  // TODO(S5): surface ask to HITL instead of collapsing onto permissionPolicy.
  return policy === "deny" ? "deny" : "allow";
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
  policy: PermissionPolicy,
): Promise<string> {
  // Layer 3 enforcement (S3b): gate the call on the spec's disposition before it runs.
  // `deny` returns a refusal string (not a throw) so the harness folds it into the tool
  // result and the model loop continues. `ask`/unset degrade to the headless policy.
  const decision = resolveDisposition(spec.disposition, policy);
  if (decision === "deny") {
    if (spec.disposition === "deny") {
      return `Tool '${spec.name}' is denied by policy.`;
    }
    // ask/unset that the headless policy refused. TODO(S5): surface ask to HITL.
    return `Tool '${spec.name}' requires approval; denied in headless mode.`;
  }
  if (spec.kind === "client") {
    throw new Error(`client tool '${spec.name}' is browser-fulfilled and cannot be executed`);
  }
  if (spec.kind === "code") {
    return runCodeTool(spec.runtime, spec.code ?? "", spec.env, req.args);
  }
  if (!callback?.endpoint) {
    throw new Error(`missing toolCallback endpoint for '${spec.name}'`);
  }
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
 * against Agenta's /tools/call (which the runner can reach), and writes the response file
 * the in-sandbox extension is waiting on. Returns `stop()` to end the loop and drain any
 * in-flight executions; call it once the prompt resolves.
 */
export function startToolRelay(
  host: RelayHost,
  relayDir: string,
  specs: ResolvedToolSpec[],
  callback: ToolCallbackContext | undefined,
  policy: PermissionPolicy,
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
        policy,
      );
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
