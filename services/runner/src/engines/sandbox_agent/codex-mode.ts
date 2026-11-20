/**
 * The ACP session modes codex-acp exposes. The runner image patches the default
 * `agent-full-access` preset from the stock `approvalPolicy: "never"` to `untrusted` (see
 * `codex-acp-patch.ts`), so codex asks before every file patch and every shell command it does
 * not know to be safe, and the run's permission policy answers. `read-only` keeps `on-request`.
 * `agent` is codex-acp's "Auto review" preset: a reviewer model inside Codex answers its
 * requests, so the run's permission policy does not see them. The sandbox policies are
 * untouched, so full access is still full access.
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
