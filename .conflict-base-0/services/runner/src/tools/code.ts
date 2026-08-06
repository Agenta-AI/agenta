/**
 * Code-tool refusal message.
 *
 * The code-tool interface still exists on the wire (a `kind: "code"` spec can be advertised),
 * but the sidecar no longer executes author-supplied snippets locally (F-010 security removal).
 * A run that carries a `code` tool is refused UP FRONT in `buildRunPlan` (`run-plan.ts`
 * `hasCodeTool` -> `CODE_TOOL_UNSUPPORTED_MESSAGE`) so the failure surfaces as a non-success run
 * result rather than being laundered into an `ok:true` reply (F-016: a per-call throw becomes a
 * tool RESULT the model echoes back as "success"). The two dispatch sites (`dispatch.ts`,
 * `relay.ts`) throw this same message inline as a defense-in-depth backstop, so even if a code
 * tool reached execution it would fail consistently without changing the public wire shape. This
 * module now holds only the message constant; the executor was removed.
 */

export const CODE_TOOL_UNSUPPORTED_MESSAGE =
  "Code tools are not supported by the sidecar.";
