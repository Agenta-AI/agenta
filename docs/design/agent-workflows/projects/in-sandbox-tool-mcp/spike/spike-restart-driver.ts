/**
 * Slice-0 spike driver: does the pinned Claude ACP adapter RESPAWN a stdio MCP
 * subprocess on the `session/load` (resume) path after a Daytona VM stop/restart?
 *
 * Run from services/runner:
 *   pnpm exec tsx ../../docs/design/agent-workflows/projects/in-sandbox-tool-mcp/spike/spike-restart-driver.ts
 *   pnpm exec tsx .../spike-restart-driver.ts --teardown <rawSandboxId>   # recovery only
 *
 * Mirrors the engine (services/runner/src/engines/sandbox_agent.ts) exactly:
 *   - provider via buildSandboxProvider("daytona", ...) with the harness key in the
 *     `secrets` slot (the engine's plan.modelEnvironment -> Daytona create envVars),
 *   - SandboxAgent.start({sandbox, persist, fetch: createCookieFetch()}),
 *   - createSession with a TYPELESS stdio mcpServers entry {name, command, args, env},
 *   - park = destroySession + sandbox.pauseSandbox(),
 *   - resume = fresh persist seeded via persist.updateSession({... agentSessionId})
 *     then sandbox.resumeSession(localSessionId) (the patched session/load path).
 *
 * NEVER prints secret values. Env is read from the ee dev env files by NAME only.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const REPO = "/home/mahmoud/code/agenta";
const RUNNER = `${REPO}/services/runner`;
const ENV_LOCAL = `${REPO}/hosting/docker-compose/ee/.env.ee.dev.local`;
const ENV_DEV = `${REPO}/hosting/docker-compose/ee/.env.ee.dev`;
const SPIKE_DIR = `${REPO}/docs/design/agent-workflows/projects/in-sandbox-tool-mcp/spike`;
const STATE_FILE = "/tmp/spike-restart-state.json";

const SANDBOX_MCP_PATH = "/home/sandbox/agenta/spike/spike-mcp.js";
const SANDBOX_LOG_PATH = "/home/sandbox/agenta/spike-mcp.log";
const CWD = "/home/sandbox/agenta/spike-cwd";
const LOCAL_SESSION_ID = "spike-restart:claude";
const MCP_ENTRY = {
  name: "agenta-tools",
  command: "node",
  args: [SANDBOX_MCP_PATH],
  env: [] as Array<{ name: string; value: string }>,
};

// The snapshot has no pgrep/ps; scan /proc cmdlines instead.
const PROC_SCAN =
  'found=0; for p in /proc/[0-9]*; do c=$(tr "\\0" " " < "$p/cmdline" 2>/dev/null); ' +
  'case "$c" in *spike-mcp*) echo "pid=${p#/proc/} cmd=$c"; found=1;; esac; done; ' +
  '[ "$found" -eq 1 ] || echo NO_PROCESS';
const PROC_SCAN_CLAUDE =
  'for p in /proc/[0-9]*; do c=$(tr "\\0" " " < "$p/cmdline" 2>/dev/null); ' +
  'case "$c" in *claude*|*acp*) echo "pid=${p#/proc/} cmd=$c";; esac; done; true';

function step(name: string) {
  console.log(`\n===== ${new Date().toISOString()} ${name} =====`);
}

/** Parse KEY=VALUE lines; last occurrence wins; strips surrounding quotes. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// sandbox-agent ships ESM-only "import" exports, so require.resolve cannot see them;
// import the runner's installed (pnpm-patched) copies by file path instead.
const runnerRequire = createRequire(`${RUNNER}/package.json`);
async function importFromRunner(spec: string): Promise<any> {
  const byPath: Record<string, string> = {
    "sandbox-agent": `${RUNNER}/node_modules/sandbox-agent/dist/index.js`,
  };
  const resolved = byPath[spec] ?? runnerRequire.resolve(spec);
  return import(pathToFileURL(resolved).href);
}

function sliceText(value: unknown, max = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}...[truncated]` : String(text);
}

async function main() {
  // ---- env (names only, never printed) -------------------------------------------------
  const local = parseEnvFile(ENV_LOCAL);
  const dev = parseEnvFile(ENV_DEV);
  // The runner's Daytona config: SANDBOX_AGENT_DAYTONA_* names the sandbox-agent snapshot
  // (agenta-sandbox-pi, daemon + Claude adapter baked); plain DAYTONA_SNAPSHOT in this env
  // file is the API code-evaluator snapshot (daytona-small, no daemon). The runner code
  // reads process.env.DAYTONA_*, so map the SANDBOX_AGENT_ values onto those names.
  for (const key of ["DAYTONA_API_KEY", "DAYTONA_API_URL", "DAYTONA_TARGET", "DAYTONA_SNAPSHOT"]) {
    const value = local[`SANDBOX_AGENT_${key}`] || local[key];
    if (!value) throw new Error(`missing ${key} in .env.ee.dev.local`);
    process.env[key] = value;
  }
  const anthropicKey = dev.ANTHROPIC_API_KEY || "";
  console.log(
    `env loaded: snapshot=${process.env.DAYTONA_SNAPSHOT} target=${process.env.DAYTONA_TARGET} ` +
      `anthropic_key=${anthropicKey ? "present" : "ABSENT"}`,
  );
  // Mirror the dev compose: the snapshot bakes what it needs; skip the Pi CLI install path.
  process.env.AGENTA_AGENT_SANDBOX_PI_INSTALLED = "false";

  // ---- modules (resolved from services/runner so the pnpm-patched pin is used) ---------
  const { SandboxAgent, InMemorySessionPersistDriver } = await importFromRunner("sandbox-agent");
  const { Daytona } = await importFromRunner("@daytonaio/sdk");
  const { buildSandboxProvider } = await import(
    pathToFileURL(`${RUNNER}/src/engines/sandbox_agent/provider.ts`).href
  );
  const { createCookieFetch } = await import(
    pathToFileURL(`${RUNNER}/src/engines/sandbox_agent/daytona.ts`).href
  );

  const daytonaClient = new Daytona();

  // ---- teardown-only recovery mode ------------------------------------------------------
  const teardownArg = process.argv.indexOf("--teardown");
  if (teardownArg !== -1) {
    const rawId = process.argv[teardownArg + 1];
    if (!rawId) throw new Error("--teardown needs a raw sandbox id");
    await deleteAndVerify(daytonaClient, rawId);
    return;
  }

  // The harness key rides the engine's own mechanism: the `secrets` argument =
  // plan.modelEnvironment -> buildDaytonaCreate -> Daytona create envVars.
  const secrets = anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {};
  const mcpServerSource = readFileSync(`${SPIKE_DIR}/spike-mcp.js`, "utf-8");

  let sandboxA: any;
  let sandboxB: any;
  let rawSandboxId = "";
  try {
    // =================== PHASE A: create, verify spawn #1 ================================
    step("A1 startSandboxAgent (mode=create)");
    const persistA = new InMemorySessionPersistDriver();
    sandboxA = await SandboxAgent.start({
      sandbox: buildSandboxProvider("daytona", {}, undefined, {}, secrets, undefined),
      persist: persistA,
      fetch: createCookieFetch(),
    });
    // Capture the prefixed id NOW: pauseSandbox() clears the handle's provider refs, so
    // sandboxA.sandboxId is undefined after park (this is also what the engine persists
    // via writeSandboxPointer before parking).
    const prefixedSandboxId = String(sandboxA.sandboxId);
    console.log(`sandboxId=${prefixedSandboxId}`);
    rawSandboxId = prefixedSandboxId.replace(/^daytona\//, "");
    writeFileSync(STATE_FILE, JSON.stringify({ rawSandboxId }, null, 2));

    step("A2 adapter/daemon pin probes");
    try {
      const agents = await sandboxA.listAgents();
      const summary = (agents?.agents ?? agents ?? []).map?.((a: any) => ({
        name: a.name ?? a.id,
        version: a.version,
        installed: a.installed,
        command: a.command,
      }));
      console.log(`agents: ${sliceText(summary, 1500)}`);
    } catch (err) {
      console.log(`listAgents failed: ${(err as Error).message}`);
    }
    await probe(sandboxA, "sandbox-agent --version 2>&1; which sandbox-agent 2>&1");
    await probe(
      sandboxA,
      "for f in $(find /usr/local/lib /usr/lib /opt /home/sandbox -maxdepth 6 -name package.json " +
        "\\( -path '*claude*' -o -path '*acp*' \\) -not -path '*/node_modules/*/node_modules/*' " +
        "2>/dev/null | head -8); do echo \"== $f\"; head -c 400 \"$f\"; echo; done",
    );

    step("A3 upload spike MCP server + cwd");
    await sandboxA.mkdirFs({ path: "/home/sandbox/agenta/spike" });
    await sandboxA.mkdirFs({ path: CWD });
    await sandboxA.writeFsFile({ path: SANDBOX_MCP_PATH }, mcpServerSource);
    console.log(`uploaded ${SANDBOX_MCP_PATH}`);

    step("A4 createSession (agent=claude, typeless stdio mcp entry)");
    const sessionA = await sandboxA.createSession({
      id: LOCAL_SESSION_ID,
      agent: "claude",
      cwd: CWD,
      sessionInit: { cwd: CWD, mcpServers: [MCP_ENTRY] },
    });
    const agentSessionIdA = sessionA.agentSessionId;
    console.log(`localSessionId=${sessionA.id} agentSessionId=${agentSessionIdA}`);
    writeFileSync(STATE_FILE, JSON.stringify({ rawSandboxId, agentSessionIdA }, null, 2));

    step("A5 verify spawn #1 (log + pgrep)");
    await readSpikeLog(sandboxA, "after createSession");
    await probe(sandboxA, PROC_SCAN);
    await probe(sandboxA, PROC_SCAN_CLAUDE);
    await probe(
      sandboxA,
      "find / -xdev -maxdepth 8 -name package.json -path \"*claude*\" 2>/dev/null | head -5",
    );

    // One short cheap prompt turn to prove end-to-end tool advertisement.
    if (anthropicKey) {
      step("A6 prompt turn #1 (spike_echo hello-phase1)");
      await runOneTurn(sessionA, "hello-phase1");
      await readSpikeLog(sandboxA, "after turn #1");
      await probe(sandboxA, PROC_SCAN);
    }

    // =================== PHASE B: park (stop) the VM =====================================
    step("B1 park: destroySession + pauseSandbox (engine order)");
    await sandboxA.destroySession(sessionA.id).catch((err: Error) => {
      console.log(`destroySession failed (continuing): ${err.message}`);
    });
    await sandboxA.pauseSandbox();
    await sandboxA.dispose().catch(() => {});
    console.log("pauseSandbox returned");

    step("B2 wait for state=stopped");
    for (let i = 0; i < 60; i++) {
      const sb = await daytonaClient.get(rawSandboxId);
      const state = String(sb.state ?? "unknown").toLowerCase();
      console.log(`state=${state}`);
      if (state === "stopped") break;
      await new Promise((r) => setTimeout(r, 2000));
      if (i === 59) throw new Error("sandbox never reached stopped");
    }

    // =================== PHASE C: restart + REAL resume path =============================
    step("C1 startSandboxAgent (mode=reconnect, by sandboxId)");
    const persistB = new InMemorySessionPersistDriver();
    sandboxB = await SandboxAgent.start({
      sandbox: buildSandboxProvider("daytona", {}, undefined, {}, secrets, undefined),
      persist: persistB,
      fetch: createCookieFetch(),
      sandboxId: prefixedSandboxId,
    });
    console.log(`reconnected sandboxId=${sandboxB.sandboxId}`);
    if (String(sandboxB.sandboxId) !== prefixedSandboxId) {
      throw new Error(
        `reconnect returned a DIFFERENT sandbox (${sandboxB.sandboxId} != ${prefixedSandboxId})`,
      );
    }

    step("C2 note restart marker + pre-resume log state");
    await probe(sandboxB, `date -Is; ${PROC_SCAN}`);
    await readSpikeLog(sandboxB, "pre-resume (should have no fresh spawn yet)");

    step("C3 seed persist + resumeSession (patched session/load path)");
    await persistB.updateSession({
      id: LOCAL_SESSION_ID,
      agent: "claude",
      agentSessionId: agentSessionIdA,
      lastConnectionId: "",
      createdAt: Date.now(),
      sessionInit: { cwd: CWD, mcpServers: [MCP_ENTRY] },
    });
    let sessionB: any;
    let loadedFromContinuity = false;
    try {
      sessionB = await sandboxB.resumeSession(LOCAL_SESSION_ID);
      loadedFromContinuity = sessionB.agentSessionId === agentSessionIdA;
      console.log(
        `resumeSession ok agentSessionId=${sessionB.agentSessionId} ` +
          `prior=${agentSessionIdA} loadedFromContinuity=${loadedFromContinuity}`,
      );
    } catch (err) {
      console.log(`resumeSession FAILED: ${(err as Error).message}`);
    }

    step("C4 verify respawn (log + pgrep)");
    await new Promise((r) => setTimeout(r, 3000));
    await readSpikeLog(sandboxB, "post-resume");
    await probe(sandboxB, PROC_SCAN);
    await probe(sandboxB, PROC_SCAN_CLAUDE);

    if (anthropicKey && sessionB) {
      step("C5 prompt turn #2 (spike_echo hello-phase2)");
      await runOneTurn(sessionB, "hello-phase2");
      await readSpikeLog(sandboxB, "after turn #2");
      await probe(sandboxB, PROC_SCAN);
    }
  } finally {
    // =================== TEARDOWN (mandatory) =============================================
    step("TEARDOWN");
    const live = sandboxB ?? sandboxA;
    try {
      if (live) {
        await live.destroySandbox();
        console.log("destroySandbox ok");
      }
    } catch (err) {
      console.log(`destroySandbox failed: ${(err as Error).message}`);
    }
    try {
      await live?.dispose?.();
    } catch {}
    if (rawSandboxId) await deleteAndVerify(daytonaClient, rawSandboxId);
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  }
}

async function probe(sandbox: any, script: string): Promise<void> {
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: ["-lc", script],
      timeoutMs: 30_000,
    });
    console.log(
      `$ ${script.slice(0, 90)}\nexit=${res?.exitCode} stdout=${sliceText(res?.stdout, 1500)}` +
        (res?.stderr ? ` stderr=${sliceText(res?.stderr, 300)}` : ""),
    );
  } catch (err) {
    console.log(`probe failed (${script.slice(0, 60)}): ${(err as Error).message}`);
  }
}

async function readSpikeLog(sandbox: any, label: string): Promise<void> {
  try {
    const bytes = await sandbox.readFsFile({ path: SANDBOX_LOG_PATH });
    const text = Buffer.from(bytes).toString("utf-8");
    console.log(`--- spike-mcp.log (${label}) ---\n${text}--- end log ---`);
  } catch (err) {
    console.log(`spike-mcp.log unreadable (${label}): ${(err as Error).message}`);
  }
}

async function runOneTurn(session: any, marker: string): Promise<void> {
  const offPerm = session.onPermissionRequest((req: any) => {
    const reply = (req.availableReplies ?? []).find((r: string) => r !== "reject") ?? "once";
    console.log(
      `permission request tool=${sliceText(req.toolCall?.title ?? req.toolCall, 120)} -> ${reply}`,
    );
    session.respondPermission(req.id, reply).catch((err: Error) => {
      console.log(`respondPermission failed: ${err.message}`);
    });
  });
  const offEvent = session.onEvent((event: any) => {
    const payload = event?.payload ?? event;
    const kind = payload?.sessionUpdate ?? payload?.update?.sessionUpdate ?? event?.type ?? "?";
    console.log(`  event ${sliceText(kind, 60)}: ${sliceText(payload, 220)}`);
  });
  try {
    // Cheapest available model; non-strict like the engine's applyModel (rejection tolerated).
    for (const model of ["claude-haiku-4-5", "claude-3-5-haiku-latest", "haiku"]) {
      try {
        await session.setModel(model);
        console.log(`model set to ${model}`);
        break;
      } catch {}
    }
    const response = await Promise.race([
      session.prompt([
        {
          type: "text",
          text:
            `Call the spike_echo tool (from the agenta-tools MCP server) with text '${marker}' ` +
            `and reply with only the tool's output.`,
        },
      ]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("prompt timed out after 180s")), 180_000),
      ),
    ]);
    console.log(`prompt done: ${sliceText(response, 300)}`);
  } catch (err) {
    console.log(`prompt turn failed: ${(err as Error).message}`);
  } finally {
    offPerm?.();
    offEvent?.();
  }
}

async function deleteAndVerify(daytonaClient: any, rawId: string): Promise<void> {
  try {
    const sb = await daytonaClient.get(rawId);
    await sb.delete();
    console.log(`daytona delete issued for ${rawId}`);
  } catch (err) {
    console.log(`daytona get/delete (${rawId}): ${(err as Error).message}`);
  }
  // Verify absence.
  for (let i = 0; i < 15; i++) {
    try {
      const sb = await daytonaClient.get(rawId);
      const state = String(sb.state ?? "?").toLowerCase();
      console.log(`still present state=${state}`);
      if (state === "destroyed") break;
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.log(`verified gone: get(${rawId}) -> ${(err as Error).message}`);
      return;
    }
  }
  console.log("WARNING: sandbox may still exist; re-run with --teardown");
}

main().then(
  () => {
    console.log("\nspike driver finished");
    process.exit(0);
  },
  (err) => {
    console.error(`\nspike driver failed: ${err?.stack ?? err}`);
    process.exit(1);
  },
);
