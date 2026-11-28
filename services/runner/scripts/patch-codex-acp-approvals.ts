/**
 * Apply the Codex ACP approval-decoupling patch to the adapter the pin step just installed.
 *
 * Runs in the runner image build immediately after `pin-codex-adapter.ts install-agent codex`
 * (decision D-005), so the baked adapter sends `untrusted` approvals under the full-access
 * preset. See `src/engines/sandbox_agent/codex-acp-patch.ts` for why, and for how the patch
 * retires once upstream lands agentclientprotocol/codex-acp#310.
 *
 * Exits non-zero when the adapter is missing or its preset no longer matches the anchor, so a
 * codex-acp version bump breaks the image build instead of silently restoring cold approvals.
 *
 *   tsx scripts/patch-codex-acp-approvals.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  applyCodexAcpApprovalPatch,
  applyCodexAcpDenyPatch,
  CODEX_ACP_BUNDLE_PATH,
  PATCHED_FULL_ACCESS_APPROVAL,
} from "../src/engines/sandbox_agent/codex-acp-patch.ts";

/**
 * The sandbox-agent daemon installs each agent process under its data dir, which it resolves
 * as `$XDG_DATA_HOME` then `$HOME/.local/share` (verified in the daemon binary). The build and
 * the runtime share a pinned HOME so the baked patch is the one the daemon finds at run time.
 */
function adapterBundlePaths(): string[] {
  const dataHomes = [
    process.env.XDG_DATA_HOME,
    join(homedir(), ".local", "share"),
  ].filter((dir): dir is string => Boolean(dir));
  const seen = new Set<string>();
  for (const dataHome of dataHomes) {
    seen.add(
      join(dataHome, "sandbox-agent", ...CODEX_ACP_BUNDLE_PATH.split("/")),
    );
  }
  return [...seen].filter((path) => existsSync(path));
}

const bundles = adapterBundlePaths();
if (bundles.length === 0) {
  console.error(
    "patch-codex-acp-approvals: no installed codex-acp bundle found. " +
      "Run the pin step (scripts/pin-codex-adapter.ts install-agent codex) first.",
  );
  process.exit(1);
}

for (const bundle of bundles) {
  const original = readFileSync(bundle, "utf8");
  const outcome = applyCodexAcpApprovalPatch(original);
  if (outcome.kind === "anchor-missing") {
    console.error(
      `patch-codex-acp-approvals: the agent-full-access approval anchor is missing in ${bundle}. ` +
        "codex-acp changed its mode presets: re-verify the approval/sandbox coupling and update " +
        "src/engines/sandbox_agent/codex-acp-patch.ts (or drop the patch if upstream decoupled them).",
    );
    process.exit(1);
  }
  let source = outcome.kind === "already-patched" ? original : outcome.source;
  if (outcome.kind === "already-patched") {
    console.log(
      `patch-codex-acp-approvals: already ${PATCHED_FULL_ACCESS_APPROVAL} in ${bundle}`,
    );
  } else {
    console.log(
      `patch-codex-acp-approvals: agent-full-access now sends ${PATCHED_FULL_ACCESS_APPROVAL} approvals in ${bundle}`,
    );
  }
  const deny = applyCodexAcpDenyPatch(source);
  if (deny.kind === "anchor-missing") {
    console.error(
      `patch-codex-acp-approvals: the tool-deny anchor is missing in ${bundle}: ` +
        `${JSON.stringify(deny.find)}. codex-acp changed its approval handling: re-verify ` +
        "and update the `deny` block of src/engines/sandbox_agent/codex-acp-patch.json.",
    );
    process.exit(1);
  }
  if (deny.kind === "already-patched") {
    console.log(
      `patch-codex-acp-approvals: tool deny already refusal in ${bundle}`,
    );
  } else {
    source = deny.source;
    console.log(`patch-codex-acp-approvals: tool deny now refusal in ${bundle}`);
  }
  if (source !== original) writeFileSync(bundle, source);
}
