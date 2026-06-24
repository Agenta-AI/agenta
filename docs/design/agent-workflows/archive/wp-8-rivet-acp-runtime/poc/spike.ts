/**
 * WP-8 Phase 0 spike: drive Pi over ACP through a local rivet daemon.
 *
 * Verifies the whole chain end to end before touching the service:
 *   SandboxAgent.start({ sandbox: local({ env }) })  // spawns `sandbox-agent server`
 *     -> createSession({ agent: "pi", cwd })          // opens an ACP session
 *       -> write AGENTS.md into cwd
 *       -> prompt([{ type: "text", text }])            // sends the user turn
 *         -> collect `agent_message_chunk` text from session events
 *           -> dispose()                               // tears the daemon down
 *
 * Run: pnpm exec tsx spike.ts "<prompt>"
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SandboxAgent } from "sandbox-agent";
import { local } from "sandbox-agent/local";

const AGENT = process.env.SPIKE_AGENT ?? "pi";
const MODEL = process.env.SPIKE_MODEL ?? "gpt-5.5";
const PROMPT = process.argv[2] ?? "Say hello in one short sentence and tell me what 2+2 is.";

const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "node_modules", ".bin");
const BIN = join(
  here,
  "node_modules/.pnpm/@sandbox-agent+cli-linux-x64@0.4.2/node_modules/@sandbox-agent/cli-linux-x64/bin/sandbox-agent",
);

function textOf(block: any): string {
  if (!block) return "";
  if (typeof block === "string") return block;
  if (block.type === "text" && typeof block.text === "string") return block.text;
  return "";
}

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "wp8-spike-"));
  writeFileSync(
    join(cwd, "AGENTS.md"),
    "You are a concise assistant. Answer in one or two short sentences.\n",
    "utf-8",
  );

  // Env handed to the daemon at birth. The local provider merges this into the
  // `sandbox-agent server` subprocess, which passes it to the pi-acp adapter and
  // then to `pi`. PI_ACP_PI_COMMAND points pi-acp at the local pi bin; PATH lets
  // the daemon resolve the pi-acp adapter binary.
  const env: Record<string, string> = {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    PI_ACP_PI_COMMAND: join(binDir, "pi"),
    PI_CODING_AGENT_DIR: join(process.env.HOME ?? "", ".pi/agent"),
    SANDBOX_AGENT_BIN: BIN,
    HOME: process.env.HOME ?? "",
  };

  console.error(`[spike] starting daemon, agent=${AGENT} model=${MODEL}`);
  const sandbox = await SandboxAgent.start({
    sandbox: local({ env, binaryPath: BIN, log: "silent" }),
  });

  let output = "";
  try {
    console.error(`[spike] creating session in ${cwd}`);
    const session = await sandbox.createSession({ agent: AGENT, cwd, model: MODEL });

    session.onEvent((event: any) => {
      const payload = event?.payload;
      // ACP session/update notifications carry the streamed assistant text.
      const update = payload?.params?.update ?? payload?.update;
      if (!update) return;
      if (update.sessionUpdate === "agent_message_chunk") {
        const t = textOf(update.content);
        if (!t) return;
        // Harnesses differ: Pi streams pure deltas, Claude streams deltas plus a
        // cumulative full snapshot. Replace when a chunk is a superset of what we
        // have (snapshot), append otherwise (delta). Unifies both without doubling.
        if (t.startsWith(output)) output = t;
        else output += t;
      }
    });

    console.error(`[spike] prompting...`);
    const res = await session.prompt([{ type: "text", text: PROMPT }]);
    console.error(`[spike] prompt returned stopReason=${(res as any)?.stopReason}`);

    console.error("[spike] OUTPUT >>>");
    console.log(output.trim());
    console.error("[spike] <<< OUTPUT");
  } finally {
    await sandbox.destroySandbox().catch(() => {});
    await sandbox.dispose().catch(() => {});
    rmSync(cwd, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[spike] FAILED:", err?.stack ?? err);
  process.exit(1);
});
