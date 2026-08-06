import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxAgent } from "sandbox-agent";
import { local } from "sandbox-agent/local";
const AGENT = process.env.SPIKE_AGENT ?? "pi";
const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "node_modules", ".bin");
const BIN = join(here, "node_modules/.pnpm/@sandbox-agent+cli-linux-x64@0.4.2/node_modules/@sandbox-agent/cli-linux-x64/bin/sandbox-agent");
const cwd = mkdtempSync(join(tmpdir(), "wp8-dump-"));
writeFileSync(join(cwd, "AGENTS.md"), "You are concise.\n", "utf-8");
const env: Record<string,string> = { PATH: `${binDir}:/home/mahmoud/.local/bin:${process.env.PATH ?? ""}`, PI_ACP_PI_COMMAND: join(binDir,"pi"), PI_CODING_AGENT_DIR: join(process.env.HOME??"",".pi/agent"), SANDBOX_AGENT_BIN: BIN, HOME: process.env.HOME??"" };
const sandbox = await SandboxAgent.start({ sandbox: local({ env, binaryPath: BIN, log: "silent" }) });
const session = await sandbox.createSession({ agent: AGENT, cwd, model: process.env.SPIKE_MODEL || undefined });
session.onEvent((event: any) => {
  const p = event?.payload;
  const u = p?.params?.update ?? p?.update;
  const su = u?.sessionUpdate;
  if (su === "usage_update" || su === "tool_call" || su === "tool_call_update") {
    console.error(`[${su}] ${JSON.stringify(u).slice(0,500)}`);
  } else if (!su && p?.result) {
    console.error(`[result] ${JSON.stringify(p.result).slice(0,400)}`);
  }
});
const res = await session.prompt([{ type: "text", text: "What is 2+2? Answer in one word." }]);
console.error(`[promptResponse] ${JSON.stringify(res).slice(0,400)}`);
await sandbox.destroySandbox().catch(()=>{});
await sandbox.dispose().catch(()=>{});
rmSync(cwd, { recursive: true, force: true });
