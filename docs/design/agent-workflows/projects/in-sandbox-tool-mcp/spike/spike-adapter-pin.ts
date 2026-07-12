/**
 * One-off probe: record the Claude ACP adapter + Claude Code versions baked into the
 * runner's Daytona snapshot (agenta-sandbox-pi). Creates a sandbox, probes, deletes it.
 *
 * Run from services/runner:
 *   pnpm exec tsx ../../docs/design/agent-workflows/projects/in-sandbox-tool-mcp/spike/spike-adapter-pin.ts
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = "/home/mahmoud/code/agenta";
const RUNNER = `${REPO}/services/runner`;
const ENV_LOCAL = `${REPO}/hosting/docker-compose/ee/.env.ee.dev.local`;

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

async function main() {
  const local = parseEnvFile(ENV_LOCAL);
  for (const key of ["DAYTONA_API_KEY", "DAYTONA_API_URL", "DAYTONA_TARGET", "DAYTONA_SNAPSHOT"]) {
    const value = local[`SANDBOX_AGENT_${key}`] || local[key];
    if (!value) throw new Error(`missing ${key}`);
    process.env[key] = value;
  }
  process.env.AGENTA_AGENT_SANDBOX_PI_INSTALLED = "false";
  console.log(`snapshot=${process.env.DAYTONA_SNAPSHOT} target=${process.env.DAYTONA_TARGET}`);

  const { SandboxAgent, InMemorySessionPersistDriver } = await import(
    pathToFileURL(`${RUNNER}/node_modules/sandbox-agent/dist/index.js`).href
  );
  const { buildSandboxProvider } = await import(
    pathToFileURL(`${RUNNER}/src/engines/sandbox_agent/provider.ts`).href
  );
  const { createCookieFetch } = await import(
    pathToFileURL(`${RUNNER}/src/engines/sandbox_agent/daytona.ts`).href
  );

  let sandbox: any;
  try {
    sandbox = await SandboxAgent.start({
      sandbox: buildSandboxProvider("daytona", {}, undefined, {}, {}, undefined),
      persist: new InMemorySessionPersistDriver(),
      fetch: createCookieFetch(),
    });
    console.log(`sandboxId=${sandbox.sandboxId}`);
    // Creating a claude session materializes the adapter under agent_processes/claude.
    await sandbox.createSession({ id: "pin:claude", agent: "claude", cwd: "/home/sandbox" });
    const probes = [
      "sandbox-agent --version",
      "AGENT_DIR=/home/sandbox/.local/share/sandbox-agent/bin/agent_processes/claude; " +
        "ls $AGENT_DIR $AGENT_DIR/node_modules 2>&1 | head -30",
      "AGENT_DIR=/home/sandbox/.local/share/sandbox-agent/bin/agent_processes/claude; " +
        "for f in $AGENT_DIR/package.json $AGENT_DIR/node_modules/*/package.json " +
        "$AGENT_DIR/node_modules/@*/*/package.json; do " +
        '[ -f "$f" ] && echo "== $f" && grep -m1 \'"name"\' "$f" && grep -m1 \'"version"\' "$f"; ' +
        "done 2>/dev/null | head -60",
      "node --version; claude --version 2>&1 || " +
        "/home/sandbox/.local/share/sandbox-agent/bin/agent_processes/claude/node_modules/.bin/claude --version 2>&1",
    ];
    for (const script of probes) {
      const res = await sandbox.runProcess({
        command: "sh",
        args: ["-lc", script],
        timeoutMs: 30_000,
      });
      console.log(`$ ${script.slice(0, 80)}\n${res?.stdout ?? ""}${res?.stderr ?? ""}`);
    }
  } finally {
    try {
      await sandbox?.destroySandbox();
      console.log("destroySandbox ok");
    } catch (err) {
      console.log(`destroySandbox failed: ${(err as Error).message}`);
    }
    await sandbox?.dispose?.().catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(String(err?.stack ?? err));
    process.exit(1);
  },
);
