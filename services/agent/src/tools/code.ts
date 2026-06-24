/**
 * Code-tool sidecar execution gate.
 *
 * The code-tool interface still exists and code tools are still advertised to harnesses. The
 * sidecar no longer executes author-supplied snippets locally, though: every delivery path
 * funnels a `kind: "code"` call through this function, so throwing here makes direct Pi,
 * sandbox Pi, and the ACP/MCP bridge fail consistently without changing the public wire shape.
 */

export type CodeRuntime = "python" | "node";

export const CODE_TOOL_UNSUPPORTED_MESSAGE =
  "Code tools are not supported by the sidecar.";

/**
 * Fail a code-tool invocation. Callers turn this throw into a tool-error result so the model
 * loop continues rather than crashing the whole run.
 */
export async function runCodeTool(
  _runtime: CodeRuntime | undefined,
  _code: string,
  _env: Record<string, string> | undefined,
  _args: unknown,
  _signal?: AbortSignal,
): Promise<string> {
  throw new Error(CODE_TOOL_UNSUPPORTED_MESSAGE);
}
