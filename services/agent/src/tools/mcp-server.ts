/**
 * Stdio MCP bridge server — REMOVED.
 *
 * This was a JSON-RPC-over-stdio MCP server that exposed backend-resolved tools to non-Pi
 * harnesses and relayed each call back to the runner. It ran as a child process ON THE RUNNER
 * HOST, outside the sandbox boundary, so a network-blocked sandbox did not confine it — the
 * same runner-host execution bypass that had code execution removed (`tools/code.ts`).
 *
 * The stdio implementation is removed. The internal gateway-tool channel was RESTORED over an
 * internal loopback HTTP MCP endpoint instead (`tools/tool-mcp-http.ts`), which launches no
 * runner-host process — so it does not reintroduce this hole (project gateway-tool-mcp).
 * Nothing launches this file anymore. If invoked directly it refuses loudly rather than serving.
 */
import { USER_MCP_UNSUPPORTED_MESSAGE } from "./mcp-bridge.ts";

process.stderr.write(`[tool-bridge] ${USER_MCP_UNSUPPORTED_MESSAGE}\n`);
process.exit(1);
