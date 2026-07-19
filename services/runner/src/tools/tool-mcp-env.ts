/**
 * The in-sandbox stdio MCP shim's env contract: the two variable NAMES the runner sets on the
 * advertised ACP stdio entry (`engines/sandbox_agent/mcp.ts` `buildInternalToolMcpEntry`) and
 * the shim (`tool-mcp-stdio.ts`) reads at startup.
 *
 * A dedicated, dependency-free module (no imports, no node builtins — bundle-safe by
 * construction) so the server-side entry builder shares the names WITHOUT importing the
 * sandbox bundle's ENTRYPOINT, and the shim bundle's import surface stays exactly
 * relay-client + relay-protocol + types.
 */

/** The in-sandbox relay dir to write request files into (reused name — the same variable the
 *  Pi extension reads; see `pi-assets.ts` / `extensions/agenta.ts`). */
export const RELAY_DIR_ENV = "AGENTA_AGENT_TOOLS_RELAY_DIR";

/** PATH to a JSON file holding the AdvertisedToolSpec array. A file, not an env value: the env
 *  is copied through four exec layers and tool JSON Schemas are unbounded. */
export const PUBLIC_SPECS_FILE_ENV = "AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE";
