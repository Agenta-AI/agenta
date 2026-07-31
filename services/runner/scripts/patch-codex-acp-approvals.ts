/**
 * Apply the Codex ACP approval-decoupling patch to the adapter the pin step just installed.
 *
 * Runs in the runner image build immediately after `pin-codex-adapter.ts install-agent codex`
 * (decision D-005), so the baked adapter sends `on-request` approvals under the full-access
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
  CODEX_ACP_BUNDLE_PATH,
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
    seen.add(join(dataHome, "sandbox-agent", ...CODEX_ACP_BUNDLE_PATH.split("/")));
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
  const outcome = applyCodexAcpApprovalPatch(readFileSync(bundle, "utf8"));
  if (outcome.kind === "anchor-missing") {
    console.error(
      `patch-codex-acp-approvals: the agent-full-access approval anchor is missing in ${bundle}. ` +
        "codex-acp changed its mode presets: re-verify the approval/sandbox coupling and update " +
        "src/engines/sandbox_agent/codex-acp-patch.ts (or drop the patch if upstream decoupled them).",
    );
    process.exit(1);
  }
  if (outcome.kind === "already-patched") {
    console.log(`patch-codex-acp-approvals: already on-request in ${bundle}`);
    continue;
  }
  writeFileSync(bundle, outcome.source);
  console.log(
    `patch-codex-acp-approvals: agent-full-access now sends on-request approvals in ${bundle}`,
  );
}
