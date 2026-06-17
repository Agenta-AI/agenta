/**
 * Daytona tool relay.
 *
 * On Daytona the harness runs in a remote cloud sandbox that can reach the public internet
 * but NOT a firewalled / private Agenta backend (the same reason tracing is built from the
 * event stream there instead of in-sandbox OTLP). So the in-sandbox Pi extension cannot
 * POST tool calls to Agenta's /tools/call directly.
 *
 * The runner CAN reach Agenta (it resolved the tools and holds the callback), and it can
 * reach the sandbox filesystem over the daemon API. So tool calls are relayed through the
 * runner via files in a sandbox dir:
 *
 *   extension: write `<id>.req.json` {callRef, args}  ──▶  poll `<id>.res.json`
 *   runner:    poll the dir, read `<id>.req.json` ──▶ /tools/call ──▶ write `<id>.res.json`
 *
 * Local runs keep the direct path (the in-process / local-daemon extension reaches Agenta);
 * the relay is only wired when AGENTA_TOOL_RELAY_DIR is set (Daytona + Pi + tools).
 */
import { callAgentaTool } from "./client.ts";
import type { ToolCallbackContext } from "../protocol.ts";

export const RELAY_REQ_SUFFIX = ".req.json";
export const RELAY_RES_SUFFIX = ".res.json";
export const RELAY_POLL_MS = Number(process.env.AGENTA_TOOL_RELAY_POLL_MS ?? 300);
export const RELAY_TIMEOUT_MS = Number(process.env.AGENTA_TOOL_RELAY_TIMEOUT_MS ?? 60000);

export interface RelayRequest {
  callRef: string;
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
 * Runner-side relay loop. Polls the sandbox relay dir for request files, executes each
 * against Agenta's /tools/call (which the runner can reach), and writes the response file
 * the in-sandbox extension is waiting on. Returns `stop()` to end the loop and drain any
 * in-flight executions; call it once the prompt resolves.
 */
export function startToolRelay(
  sandbox: any,
  relayDir: string,
  callback: ToolCallbackContext,
): { stop: () => Promise<void> } {
  let active = true;
  const seen = new Set<string>();
  const inflight: Promise<void>[] = [];

  const handle = async (reqName: string): Promise<void> => {
    const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
    let res: RelayResponse;
    try {
      const bytes = await sandbox.readFsFile({ path: `${relayDir}/${reqName}` });
      const raw = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
      const req = JSON.parse(raw) as RelayRequest;
      const text = await callAgentaTool(
        callback.endpoint,
        callback.authorization,
        req.callRef,
        req.toolCallId ?? id,
        req.args,
      );
      res = { ok: true, text };
    } catch (err) {
      res = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    try {
      await sandbox.writeFsFile(
        { path: `${relayDir}/${id}${RELAY_RES_SUFFIX}` },
        JSON.stringify(res),
      );
    } catch {
      // The extension will time out and surface a tool error; nothing else to do here.
    }
  };

  const loop = (async () => {
    while (active) {
      try {
        const ls = await sandbox.runProcess({
          command: "ls",
          args: ["-1", relayDir],
          timeoutMs: 10_000,
        });
        const names = String(ls?.stdout ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
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
