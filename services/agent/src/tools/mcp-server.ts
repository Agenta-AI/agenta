/**
 * Stdio MCP bridge server — REMOVED.
 *
 * This was a JSON-RPC-over-stdio MCP server that exposed backend-resolved tools to non-Pi
 * harnesses and relayed each call back to the runner. It ran as a child process ON THE RUNNER
 * HOST, outside the sandbox boundary, so a network-blocked sandbox did not confine it — the
 * same runner-host execution bypass that had code execution removed (`tools/code.ts`).
 *
 * The implementation is removed and stdio MCP delivery is disabled in the sidecar until the
 * security issues are fixed. Nothing launches this server anymore (`tools/mcp-bridge.ts`
 * `buildToolMcpServers` throws `MCP_UNSUPPORTED_MESSAGE` instead of spawning it, and
 * `run-plan.ts` refuses any run carrying a stdio MCP server). If invoked directly it refuses
 * loudly rather than serving.
 */
import { MCP_UNSUPPORTED_MESSAGE } from "./mcp-bridge.ts";

process.stderr.write(`[tool-bridge] ${MCP_UNSUPPORTED_MESSAGE}\n`);
process.exit(1);
