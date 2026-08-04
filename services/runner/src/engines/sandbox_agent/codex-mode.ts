/**
 * The ACP session modes codex-acp exposes. All three send `on-request` approvals in our image:
 * `read-only` and `agent` ship that way, and the runner image patches the `agent-full-access`
 * preset from the stock `approvalPolicy: "never"` to `on-request` (see `codex-acp-patch.ts`).
 * That is what makes Codex tool approvals park WARM, like Claude's, instead of resuming cold on
 * a follow-up turn. The sandbox policies are untouched, so full access is still full access and
 * shell stays gate-free (codex only asks for exec approval under a restricted filesystem sandbox).
 */
export const CODEX_MODES = ["agent", "read-only", "agent-full-access"] as const;
export type CodexMode = (typeof CODEX_MODES)[number];

export const DEFAULT_CODEX_MODE: CodexMode = "agent-full-access";

/** Resolve a valid per-run override, falling back to the approved Codex default. */
export function resolveCodexMode(requested: string | undefined): CodexMode {
  return CODEX_MODES.includes(requested as CodexMode)
    ? (requested as CodexMode)
    : DEFAULT_CODEX_MODE;
}

/** Apply the ACP session mode without letting a bridge failure fail the run. */
export async function applyCodexMode(
  session: any,
  mode: CodexMode,
  log?: (message: string) => void,
): Promise<CodexMode | undefined> {
  try {
    await session.setConfigOption("mode", mode);
    log?.(`[codex-mode] applied mode=${mode}`);
    return mode;
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    log?.(`[codex-mode] setConfigOption failed mode=${mode}: ${message}`);
    return undefined;
  }
}
