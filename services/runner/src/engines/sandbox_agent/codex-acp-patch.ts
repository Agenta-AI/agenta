/**
 * Build-time patch for the pinned Codex ACP bridge (`@agentclientprotocol/codex-acp`).
 *
 * WHY THIS EXISTS. codex-acp ships three preset session modes and re-sends each preset's
 * approval policy and sandbox policy on EVERY turn, overriding `config.toml` and
 * `CODEX_CONFIG`. Its `agent-full-access` preset hardcodes `approvalPolicy: "never"` right
 * next to the unsandboxed `dangerFullAccess` sandbox policy, so the two are coupled even
 * though codex core takes them as independent per-turn parameters.
 *
 * We must run full access: codex's own OS sandbox (bubblewrap) cannot initialize inside our
 * containers, so `agent` mode turns every write-ish shell command into sandbox-failure noise
 * (derisk probe P7). Under `never`, codex auto-approves every gate, so no permission request
 * ever reaches the runner and an `ask` tool can only be approved COLD: the turn dies, the user
 * approves, and the model re-issues the call on a follow-up turn. Claude and Pi park WARM —
 * the turn stays alive and continues in place the moment the human answers.
 *
 * This patch decouples the pair for the full-access preset only: approvals become
 * `on-request` while the sandbox stays `dangerFullAccess`. Codex then raises native permission
 * requests for MCP (Agenta) tool calls, which ride the keep-alive park the runner already
 * built for Claude, so Codex approvals become warm. Shell stays gate-free because codex only
 * asks for exec approval when the filesystem sandbox is restricted, which full access is not.
 *
 * RETIREMENT. Upstream issue agentclientprotocol/codex-acp#310 asks for the same decoupling.
 * When an accepted release ships it, drop this patch and bump the pin: `applyCodexAcpApprovalPatch`
 * reports `already-patched` for a source that already sends `on-request`, so the transition is safe.
 *
 * FAILING LOUDLY IS THE POINT. The image build calls this and exits non-zero on `anchor-missing`.
 * A codex-acp version whose preset no longer matches must break the build, not silently ship
 * cold approvals again.
 */

/**
 * The anchor lives in JSON, not here, because TWO images must patch identically: the runner
 * image (through `scripts/patch-codex-acp-approvals.ts`) and the Daytona sandbox snapshot
 * (through `images/sandbox/daytona/build_snapshot.py`, which reads the same file). If the two
 * anchors ever drift, a Daytona run silently keeps cold approvals while a local run is warm —
 * the exact split this amendment exists to remove.
 *
 * The pattern is anchored on the `AgentFullAccess` constructor call AND on the
 * `dangerFullAccess` sandbox literal that follows the approval argument, so it can only ever
 * rewrite the approval policy of the full-access preset. The `read-only` and `agent` presets
 * already send `on-request` and are left untouched.
 */
import patchSpec from "./codex-acp-patch.json" with { type: "json" };

/** The preset's stock approval policy, and what we replace it with. */
export const STOCK_FULL_ACCESS_APPROVAL = patchSpec.stock;
export const PATCHED_FULL_ACCESS_APPROVAL = patchSpec.patched;

/** Where the sandbox-agent daemon installs the bundle, under its data dir. */
export const CODEX_ACP_BUNDLE_PATH = patchSpec.bundlePath;

const FULL_ACCESS_APPROVAL_RE = new RegExp(patchSpec.pattern);

export type CodexAcpPatchOutcome =
  | { kind: "patched"; source: string }
  | { kind: "already-patched" }
  | { kind: "anchor-missing" };

/**
 * Rewrite the full-access preset's approval policy in a codex-acp bundle.
 *
 * Idempotent: a source already sending `on-request` returns `already-patched` and is not
 * rewritten, so a rebuilt image layer (or a re-run against a baked image) is a no-op.
 */
export function applyCodexAcpApprovalPatch(
  source: string,
): CodexAcpPatchOutcome {
  const match = FULL_ACCESS_APPROVAL_RE.exec(source);
  if (!match) return { kind: "anchor-missing" };
  if (match[2] === PATCHED_FULL_ACCESS_APPROVAL)
    return { kind: "already-patched" };
  return {
    kind: "patched",
    source:
      source.slice(0, match.index) +
      `${match[1]}"${PATCHED_FULL_ACCESS_APPROVAL}"${match[3]}` +
      source.slice(match.index + match[0].length),
  };
}
