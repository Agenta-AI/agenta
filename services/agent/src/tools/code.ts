/**
 * Code-tool sidecar execution gate.
 *
 * The code-tool interface still exists on the wire, but the sidecar no longer executes
 * author-supplied snippets locally (F-010 security removal). A run that carries a `code` tool
 * is refused UP FRONT in `buildRunPlan` (`run-plan.ts` `hasCodeTool` ->
 * `CODE_TOOL_UNSUPPORTED_MESSAGE`) so the failure surfaces as a non-success run result rather
 * than being laundered into an `ok:true` reply (F-016: a per-call throw becomes a tool RESULT
 * the model echoes back as "success"). This per-call throw remains as a defense-in-depth
 * backstop: every delivery path (direct Pi, sandbox Pi, the ACP/MCP bridge, the relay) funnels
 * a `kind: "code"` call through here, so even if a code tool reaches execution it fails
 * consistently, without changing the public wire shape.
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
