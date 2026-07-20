/**
 * Relay wire protocol: the file-name suffixes, request/response JSON shapes, request
 * serialization, and the env-derived timing constants shared by every relay writer and
 * the runner-side reader (tools/relay.ts).
 *
 * This module is the writer-shared relay protocol and MUST stay dependency-free (node
 * builtins only, no imports from other src modules) so it stays bundle-safe: the Pi
 * extension bundle and the future in-sandbox MCP shim (#5234) consume it from inside
 * the sandbox, where server-side code must never be pulled in.
 */

export const RELAY_REQ_SUFFIX = ".req.json";
export const RELAY_RES_SUFFIX = ".res.json";
export const RELAY_POLL_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_POLLING ?? 300,
);
export const RELAY_TIMEOUT_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_RELAY_TIMEOUT ?? 60000,
);

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
  /**
   * The "paused" answer variant: a client tool parked, so the turn ends and the browser result
   * returns on the cold-replay resume. An answer is one of three — success (`ok: true, text`),
   * failure (`ok: false, error`), or pause (`ok: true, paused: true`). Additive but NOT blindly
   * backward-compatible: a reader that ignores `paused` misreads a pause as an empty-text success,
   * so the shim must check `paused` before `ok` (see relay-client.ts). Written only on the non-Pi
   * in-sandbox shim path (`writePausedAnswer`).
   */
  paused?: true;
}
export type RelayResponse = ExecuteRelayResponse;

/** Make a tool-call id safe to use as a filename (and bounded). */
export function sanitizeRelayId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "tool";
}

/**
 * Temporary publication name for one relay file (atomic publication, plan decision 2).
 * Both directions write the full contents to this name first and then rename it to
 * `finalPath`. Temp names never match the `.req.json`/`.res.json` suffix filters, so no
 * reader or watcher ever lists them, and a same-directory rename is atomic on POSIX, so
 * a final-name file always holds complete bytes — a wake can never observe partial JSON.
 */
export function relayTempPath(finalPath: string): string {
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${finalPath}.tmp.${nonce}`;
}

/**
 * Serialize one execute request to the exact bytes every relay writer produces. The key
 * order (toolName, toolCallId, args) and the `args ?? {}` default are part of the
 * cross-writer contract; the golden test in tests/unit/relay-client.test.ts pins them.
 */
export function serializeRelayRequest(req: ExecuteRelayRequest): string {
  return JSON.stringify({
    toolName: req.toolName,
    toolCallId: req.toolCallId,
    args: req.args ?? {},
  });
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Read one boolean relay env flag at CALL time (so a test or an operator restart takes
 * effect immediately). The exact strings "false"/"0" disable, "true"/"1" enable, and
 * anything else (unset, empty, garbage) falls back to `defaultValue`. Shared by the
 * hop-1 response-watch flag (default true) and the hop-2 remote-watch flag (default
 * false) so the two flags cannot drift in parsing.
 */
export function relayEnvFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  return defaultValue;
}
