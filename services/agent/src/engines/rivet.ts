/**
 * WP-8 rivet harness driver.
 *
 * Drives a coding harness (Pi, Claude Code, ...) over the Agent Client Protocol (ACP)
 * through a rivet `sandbox-agent` daemon, instead of the bespoke Pi SDK calls in the pi
 * engine. It serves the same /run contract (AgentRunRequest -> AgentRunResult), so the
 * Python side stays thin and the choice of harness/sandbox is config, not new code.
 *
 * Per invoke (cold), mirroring the shipped code-evaluator DaytonaRunner pattern:
 *
 *   SandboxAgent.start({ sandbox: local({ env }) | daytona({ create }) })
 *     -> createSession({ agent: <harness>, cwd, model })
 *       -> write AGENTS.md into cwd
 *       -> session.prompt([{ type: "text", text }])
 *         -> accumulate ACP `agent_message_chunk` text + build the trace
 *           -> destroySandbox()
 *
 * Two orthogonal axes swap independently: the sandbox (where the daemon runs) and the
 * harness (which engine). The ACP boundary is daemon-to-harness; the service-to-rivet
 * hop stays harness-agnostic behind the Harness port.
 *
 * Tracing is built here from the ACP event stream (see tracing/otel.ts createRivetOtel),
 * so it is uniform across every harness and always nests under the caller's /invoke
 * span. stdout is reserved for the JSON result (see cli.ts); logs go to stderr.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SandboxAgent, InMemorySessionPersistDriver } from "sandbox-agent";
import { local } from "sandbox-agent/local";
import { daytona } from "sandbox-agent/daytona";

import { createRivetOtel } from "../tracing/otel.ts";
import { resolveSkillDirs } from "./skills.ts";
import { buildToolMcpServers, type McpServerStdio } from "../tools/mcp-bridge.ts";
import { executableToolSpecs, publicToolSpecs } from "../tools/public-spec.ts";
import {
  localRelayHost,
  sandboxRelayHost,
  startToolRelay,
} from "../tools/relay.ts";
import {
  PolicyResponder,
  decisionToReply,
  policyFromRequest,
  type Responder,
} from "../responder.ts";
import {
  type AgentRunRequest,
  type AgentRunResult,
  type ChatMessage,
  type ContentBlock,
  type EmitEvent,
  type HarnessCapabilities,
  type McpServerConfig,
  type ResolvedToolSpec,
  type ToolCallbackContext,
  messageText,
  resolvePromptText,
  resolveRunSessionId,
} from "../protocol.ts";

const require = createRequire(import.meta.url);
// services/agent/src/engines/rivet.ts -> services/agent
const PKG_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ADAPTER_BIN_DIR = join(PKG_ROOT, "node_modules", ".bin");

/** Map node platform/arch to the @sandbox-agent CLI binary package. */
const CLI_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@sandbox-agent/cli-darwin-arm64",
  "darwin-x64": "@sandbox-agent/cli-darwin-x64",
  "linux-x64": "@sandbox-agent/cli-linux-x64",
  "linux-arm64": "@sandbox-agent/cli-linux-arm64",
  "win32-x64": "@sandbox-agent/cli-win32-x64",
};

function log(message: string): void {
  process.stderr.write(`[rivet-wrapper] ${message}\n`);
}

/**
 * Resolve the sandbox-agent daemon binary. Prefers SANDBOX_AGENT_BIN, then the
 * platform CLI package shipped with `sandbox-agent` (resolved from the SDK's own
 * location, since pnpm nests it under `sandbox-agent`). Ensures it is executable
 * (pnpm may skip the package's chmod postinstall). Returns undefined when not found;
 * the local provider then runs its own resolution and surfaces a clear error.
 */
function resolveDaemonBinary(): string | undefined {
  const fromEnv = process.env.SANDBOX_AGENT_BIN;
  if (fromEnv && existsSync(fromEnv)) return ensureExecutable(fromEnv);

  const pkg = CLI_PACKAGES[`${process.platform}-${process.arch}`];
  if (!pkg) return undefined;
  const bin = process.platform === "win32" ? "sandbox-agent.exe" : "sandbox-agent";
  try {
    // Resolve from the sandbox-agent package context (its node_modules sees the
    // sibling CLI package in the pnpm layout); package.json blocks the subpath, so
    // resolve from the main entry instead.
    const sdkRequire = createRequire(require.resolve("sandbox-agent"));
    const pkgJson = sdkRequire.resolve(`${pkg}/package.json`);
    const resolved = join(dirname(pkgJson), "bin", bin);
    if (existsSync(resolved)) return ensureExecutable(resolved);
  } catch {
    // fall through to a store scan
  }
  // Fallback: scan the pnpm store for the platform binary.
  try {
    const store = join(PKG_ROOT, "node_modules", ".pnpm");
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith(`@sandbox-agent+cli-${process.platform}`)) continue;
      const candidate = join(store, entry, "node_modules", pkg, "bin", bin);
      if (existsSync(candidate)) return ensureExecutable(candidate);
    }
  } catch {
    // store not present
  }
  return undefined;
}

function ensureExecutable(path: string): string {
  try {
    chmodSync(path, 0o755);
  } catch {
    // read-only fs (e.g. baked snapshot already +x): ignore
  }
  return path;
}

// The bundled Agenta Pi extension (tracing + tools). Built by `pnpm run build:extension`
// and into the image; installed into Pi's agent dir so Pi loads it on every run.
const EXTENSION_BUNDLE =
  process.env.AGENTA_RIVET_EXTENSION_BUNDLE ?? join(PKG_ROOT, "dist", "extensions", "agenta.js");

/**
 * Env the Agenta Pi extension reads. Propagating the trace context here is what makes Pi
 * emit its real spans under the caller's `/invoke` span. Tool env contains only public
 * metadata plus the relay directory; private specs/auth stay in the runner. Empty keys are
 * omitted so the extension stays inert when nothing applies.
 */
function buildPiExtensionEnv(
  request: AgentRunRequest,
  tracing: boolean,
  opts: { relayDir?: string; usageOutPath?: string } = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  // Tracing env is omitted when the harness process can't reach Agenta's OTLP (Daytona):
  // there the runner traces from the event stream instead, and the extension only does
  // tools + the usage writeback.
  const trace = tracing ? request.trace : undefined;
  if (trace?.traceparent) env.AGENTA_TRACEPARENT = trace.traceparent;
  if (trace?.endpoint) env.AGENTA_OTLP_ENDPOINT = trace.endpoint;
  if (trace?.authorization) env.AGENTA_OTLP_AUTHORIZATION = trace.authorization;
  if (trace && trace.captureContent === false) env.AGENTA_CAPTURE_CONTENT = "false";

  const specs = publicToolSpecs((request.customTools as ResolvedToolSpec[]) ?? []);
  if (specs.length && opts.relayDir) {
    env.AGENTA_TOOL_PUBLIC_SPECS = JSON.stringify(specs);
    env.AGENTA_TOOL_RELAY_DIR = opts.relayDir;
  }
  if (opts.usageOutPath) env.AGENTA_USAGE_OUT = opts.usageOutPath;
  return env;
}

/** Install the extension bundle into a local Pi agent dir's extensions/. Best-effort. */
function installPiExtensionLocal(agentDir: string): void {
  if (!existsSync(EXTENSION_BUNDLE)) {
    log(`pi extension bundle missing at ${EXTENSION_BUNDLE} (run build:extension)`);
    return;
  }
  try {
    const dir = join(agentDir, "extensions");
    mkdirSync(dir, { recursive: true });
    copyFileSync(EXTENSION_BUNDLE, join(dir, "agenta.js"));
  } catch (err) {
    log(`pi extension install skipped: ${(err as Error).message}`);
  }
}

/** Upload the extension bundle into a Daytona sandbox's Pi extensions dir. Best-effort. */
async function uploadPiExtensionToSandbox(sandbox: any, agentDir: string): Promise<void> {
  if (!existsSync(EXTENSION_BUNDLE)) return;
  try {
    const dir = `${agentDir}/extensions`;
    await sandbox.mkdirFs({ path: dir });
    await sandbox.writeFsFile({ path: `${dir}/agenta.js` }, readFileSync(EXTENSION_BUNDLE, "utf-8"));
  } catch (err) {
    log(`pi extension upload skipped: ${(err as Error).message}`);
  }
}

/**
 * Install the Agenta harness's forced skill dirs into a local Pi agent dir's `skills/`. Pi
 * auto-discovers and enables user-scope skills (`<agentDir>/skills/`) on every run, unlike
 * project skills (`<cwd>/.pi/skills/`), which are trust-gated and would not load in this
 * headless run — so the agent dir is the right home, mirroring the extension install above.
 * Each skill keeps its directory name (the contract with the SDK's forced-skill list).
 * Best-effort: a skill that fails to copy is logged and skipped, never failing the run.
 */
function installSkillsLocal(agentDir: string, skillDirs: string[]): void {
  for (const src of skillDirs) {
    try {
      const dest = join(agentDir, "skills", basename(src));
      mkdirSync(dirname(dest), { recursive: true });
      // dereference so a skill's symlinked assets materialize as real files, matching the
      // Daytona uploader (which has no symlink target on the remote FS).
      cpSync(src, dest, { recursive: true, dereference: true });
    } catch (err) {
      log(`skill install skipped for ${basename(src)}: ${(err as Error).message}`);
    }
  }
}

/**
 * Seed a throwaway local Pi agent dir from `sourceAgentDir` (the login: auth.json /
 * settings.json) and install the Agenta extension and forced skills into it. The Agenta
 * harness forces skills into the *user-scope* agent dir (the only place pi-acp auto-loads
 * them headlessly), so writing them into the shared `PI_CODING_AGENT_DIR` would leak them
 * into later plain `pi` runs on the same sidecar and could pollute a developer's real
 * `~/.pi/agent`. A per-run dir keeps each Agenta run's skills to itself; the daemon is
 * pointed at it via `PI_CODING_AGENT_DIR`, and the caller removes it after the run. This
 * mirrors the Daytona path, where the sandbox already gives each run a fresh agent dir.
 */
function prepareLocalAgentDir(sourceAgentDir: string, skillDirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-pi-agentdir-"));
  // Carry the login forward so pi-acp still authenticates (OAuth/auth.json), exactly the
  // files the Daytona path uploads.
  for (const name of ["auth.json", "settings.json"]) {
    const src = join(sourceAgentDir, name);
    try {
      if (existsSync(src)) copyFileSync(src, join(dir, name));
    } catch (err) {
      log(`agent-dir seed skipped for ${name}: ${(err as Error).message}`);
    }
  }
  installPiExtensionLocal(dir);
  installSkillsLocal(dir, skillDirs);
  return dir;
}

/**
 * Upload the forced skill dirs into a Daytona sandbox's Pi `skills/` (user scope), the remote
 * counterpart of {@link installSkillsLocal}. Walks each skill directory and writes every file
 * through the sandbox FS API. `writeFsFile` takes a string body, so skill assets are uploaded
 * as UTF-8 text (the SKILL.md and any text helpers); binary skill assets are a follow-up.
 * Best-effort per skill.
 */
async function uploadSkillsToSandbox(
  sandbox: any,
  agentDir: string,
  skillDirs: string[],
): Promise<void> {
  for (const src of skillDirs) {
    try {
      await uploadDirToSandbox(sandbox, src, `${agentDir}/skills/${basename(src)}`);
    } catch (err) {
      log(`skill upload skipped for ${basename(src)}: ${(err as Error).message}`);
    }
  }
}

/** Recursively upload a host directory tree into a sandbox path via the FS API. */
async function uploadDirToSandbox(
  sandbox: any,
  srcDir: string,
  destDir: string,
): Promise<void> {
  await sandbox.mkdirFs({ path: destDir });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = `${destDir}/${entry.name}`;
    // Resolve symlinks to their target kind so a symlinked file/dir is uploaded by content,
    // matching the dereferencing local copy (a broken link is skipped).
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const st = statSync(srcPath);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) {
      await uploadDirToSandbox(sandbox, srcPath, destPath);
    } else if (isFile) {
      await sandbox.writeFsFile({ path: destPath }, readFileSync(srcPath, "utf-8"));
    }
  }
}

/**
 * The environment the daemon is born with. The local provider merges this into the
 * `sandbox-agent server` subprocess, which passes it to the ACP adapter and then to
 * the harness. This is also where per-invoke trace/secret injection would go for a
 * warm-daemon model; under one-daemon-per-invoke the in-process tracer handles spans,
 * so this only needs to make the adapters and harness resolvable + authed.
 */
function buildDaemonEnv(harness: string): Record<string, string> {
  const env: Record<string, string> = {};

  // Adapters (pi-acp, claude-agent-acp) and the pi CLI live in our node_modules/.bin;
  // claude CLI is on the inherited PATH. Prepend ours, keep the inherited PATH.
  const extra = process.env.AGENTA_RIVET_ADAPTER_PATH;
  env.PATH = [ADAPTER_BIN_DIR, extra, process.env.PATH].filter(Boolean).join(":");

  // Pi: point pi-acp at our pi bin and the agent dir that carries auth.json.
  env.PI_ACP_PI_COMMAND =
    process.env.AGENTA_RIVET_PI_COMMAND ?? join(ADAPTER_BIN_DIR, "pi");
  const piAgentDir = process.env.PI_CODING_AGENT_DIR;
  if (piAgentDir) env.PI_CODING_AGENT_DIR = piAgentDir;

  // Keep HOME so harness logins (~/.pi/agent, ~/.claude) resolve.
  if (process.env.HOME) env.HOME = process.env.HOME;

  // Harness LLM auth passed as launch env, never written into the agent filesystem.
  for (const key of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CONFIG_DIR",
    "GEMINI_API_KEY",
  ]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }

  return env;
}

/** The latest user turn (shared protocol helper; flattens content blocks to text). */
const resolvePrompt = resolvePromptText;

/** Prior turns (everything before the latest user message) for trace + history. */
function priorMessages(request: AgentRunRequest): ChatMessage[] {
  const messages = request.messages ?? [];
  const latest = resolvePrompt(request);
  // Drop the trailing user turn (it is the prompt we send) to avoid double-counting.
  if (messages.length && messages[messages.length - 1].role === "user") {
    return messages.slice(0, -1);
  }
  // No trailing user message (prompt came in explicitly): drop only the LAST user turn
  // whose text matches the prompt being sent, not every matching turn (repeated short
  // turns like "yes"/"continue" would otherwise vanish from the replayed history).
  let lastMatch = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messageText(messages[i].content) === latest) {
      lastMatch = i;
      break;
    }
  }
  return lastMatch === -1 ? messages : messages.filter((_, i) => i !== lastMatch);
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Render one message for the replayed transcript, INCLUDING resolved tool turns. Under the
 * cold model the harness rebuilds context from this text, and ACP prompt content blocks
 * cannot carry tool calls/results — so a resolved interaction (an approved tool that ran, a
 * client-fulfilled tool) is encoded here as text, letting the model resume from the result
 * instead of re-asking. This is the cross-turn HITL continuation substrate: the `/messages`
 * egress folds inbound UIMessage tool/approval parts into `tool_call` / `tool_result` content
 * blocks, and they survive into the replay here. Plain string / text blocks pass through;
 * image/resource blocks are summarized.
 */
export function messageTranscript(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "tool_call") {
      parts.push(`[called ${block.toolName ?? "tool"}(${safeJson(block.input)})]`);
    } else if (block.type === "tool_result") {
      const body = safeJson(block.output);
      parts.push(`[${block.toolName ?? "tool"} ${block.isError ? "error" : "returned"}: ${body}]`);
    } else if (block.type === "image") {
      parts.push("[image]");
    } else if (block.type === "resource") {
      parts.push(block.uri ? `[resource: ${block.uri}]` : "[resource]");
    }
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * The text sent over ACP for this turn. Each invoke is a cold sandbox, so prior turns
 * are replayed as transcript context ahead of the latest user message — this is the
 * "persisted message history replayed" model, with the client/playground holding the
 * history. Capped by AGENTA_AGENT_HISTORY_MAX_CHARS so replay tokens stay bounded.
 */
export function buildTurnText(request: AgentRunRequest): string {
  const latest = resolvePrompt(request);
  const history = priorMessages(request).filter((m) => messageTranscript(m.content));
  if (history.length === 0) return latest;

  const maxChars = Number(process.env.AGENTA_AGENT_HISTORY_MAX_CHARS ?? 24000);
  let transcript = history.map((m) => `${m.role}: ${messageTranscript(m.content)}`).join("\n");
  if (transcript.length > maxChars) transcript = transcript.slice(-maxChars);
  return (
    `Conversation so far:\n${transcript}\n\n` +
    `Continue the conversation. The user now says:\n${latest}`
  );
}

/**
 * Convert user-declared MCP servers (already resolved server-side, secrets injected into
 * `env`) into ACP stdio entries. Only `stdio` is delivered over ACP today; `http`/remote
 * carries no auth on the wire by design and is skipped. The per-server `tools` allowlist is
 * NOT enforced over ACP in v1 — the harness lists all of a server's tools — so it is dropped
 * with a log rather than silently implying a filter that does not happen.
 */
export function toAcpMcpServers(servers: McpServerConfig[] | undefined): McpServerStdio[] {
  const out: McpServerStdio[] = [];
  for (const s of servers ?? []) {
    if ((s.transport ?? "stdio") !== "stdio" || !s.command) {
      log(`skipping non-stdio MCP server '${s?.name ?? "?"}' (remote transport deferred)`);
      continue;
    }
    if (s.tools && s.tools.length > 0) {
      log(`MCP server '${s.name}': per-server tool allowlist not enforced over ACP (v1)`);
    }
    out.push({
      name: s.name,
      command: s.command,
      args: s.args ?? [],
      env: Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value: String(value) })),
    });
  }
  return out;
}

/**
 * Pick the harness-specific model id for a requested name. Harnesses expose their own
 * ids (Pi: "openai-codex/gpt-5.5"; Claude: its own). Match exact, then by the id after
 * the provider prefix, so "gpt-5.5" resolves to "openai-codex/gpt-5.5".
 */
function pickModel(allowed: string[], wanted?: string): string | undefined {
  if (!wanted) return undefined;
  if (allowed.includes(wanted)) return wanted;
  const suffix = (id: string) => id.slice(id.indexOf("/") + 1);
  return (
    allowed.find((id) => suffix(id) === wanted) ??
    allowed.find((id) => suffix(id) === suffix(wanted)) ??
    undefined
  );
}

/** Enumerate the harness's selectable model ids from the session config options. */
async function allowedModels(session: any): Promise<string[]> {
  try {
    const options = await session.getConfigOptions();
    const modelOpt = (options ?? []).find(
      (o: any) => o.category === "model" || o.id === "model",
    );
    const choices = modelOpt?.options ?? [];
    return choices.map((c: any) => c.id).filter(Boolean);
  } catch {
    return [];
  }
}

/** Parse the allowed model ids out of an UnsupportedSessionValueError message. */
function allowedFromError(err: unknown): string[] {
  const match = /Allowed values:\s*(.+?)\s*$/.exec(String((err as Error)?.message ?? err));
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Apply the requested model to a session, normalizing to the harness's own id. Tries the
 * value as given first (already-qualified ids pass); on rejection it reads the allowed
 * ids from the error (always listed there) or the session config and retries a match.
 * Returns the id set, or undefined when no match exists (the harness keeps its default
 * rather than failing the run).
 */
async function applyModel(session: any, wanted?: string): Promise<string | undefined> {
  if (!wanted) return undefined;
  try {
    await session.setModel(wanted);
    return wanted;
  } catch (err) {
    const allowed = allowedFromError(err);
    const fallbackAllowed = allowed.length ? allowed : await allowedModels(session);
    const match = pickModel(fallbackAllowed, wanted);
    if (match && match !== wanted) {
      try {
        await session.setModel(match);
        return match;
      } catch {
        // fall through to harness default
      }
    }
    log(`model '${wanted}' not settable (${(err as Error).message}); using harness default`);
    return undefined;
  }
}

/**
 * In-sandbox env for the Daytona daemon: where Pi reads its login, any provider keys,
 * and the Agenta extension env (traceparent + OTLP + tool spec) so the remote Pi traces
 * and runs tools exactly like local. No local-only paths (PATH/PI_ACP_PI_COMMAND) here.
 */
function daytonaEnvVars(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {
    PI_CODING_AGENT_DIR: DAYTONA_PI_DIR,
    ...piExtEnv,
    // Provider API keys from the vault: the in-sandbox harness authenticates with these.
    ...secrets,
  };
  // Point pi-acp at the `pi` we install into the sandbox (the image lacks it).
  if (DAYTONA_PI_INSTALL) {
    env.PI_ACP_PI_COMMAND = `${DAYTONA_PI_INSTALL_DIR}/node_modules/.bin/pi`;
  }
  return env;
}

/**
 * Build the rivet sandbox provider for the requested axis.
 *
 * Daytona needs an image that carries both the rivet daemon and the harness CLI. Rivet's
 * `-full` image ships the daemon and the ACP adapters but NOT the `pi` CLI, so we run
 * from a pre-baked snapshot (`AGENTA_RIVET_DAYTONA_SNAPSHOT`, default `agenta-rivet-pi`,
 * built by poc/build_rivet_snapshot.py) that adds `pi`; this avoids a ~150s per-invoke
 * `npm install pi`. `AGENTA_RIVET_DAYTONA_IMAGE` overrides with a plain image instead. The
 * code-evaluator DAYTONA_SNAPSHOT is intentionally NOT reused (it has no daemon). The
 * provider key comes from the vault env; Pi's OAuth login is only uploaded when no key.
 */
function buildSandboxProvider(
  sandboxId: string,
  env: Record<string, string>,
  binaryPath: string | undefined,
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
) {
  if (sandboxId === "daytona") {
    const snapshot = process.env.AGENTA_RIVET_DAYTONA_SNAPSHOT;
    const image = process.env.AGENTA_RIVET_DAYTONA_IMAGE;
    const target = process.env.DAYTONA_TARGET;
    return daytona({
      ...(image ? { image } : {}),
      create: {
        // The rivet provider always sets a default `image`, which Daytona turns into a
        // build entry that conflicts with `snapshot`. Spreading image:undefined last
        // suppresses that so the snapshot is used as-is.
        ...(snapshot ? { snapshot, image: undefined } : {}),
        ...(target ? { target } : {}),
        envVars: daytonaEnvVars(piExtEnv, secrets),
        ephemeral: true,
      } as any,
    });
  }
  // local: spawn `sandbox-agent server` on this host with the daemon env merged in.
  const logMode = (process.env.AGENTA_RIVET_DAEMON_LOG ?? "silent") as any;
  return local({ env, binaryPath, log: logMode });
}

/** In-sandbox Pi agent dir on the rivet `-full` image (daemon runs as user `sandbox`). */
const DAYTONA_PI_DIR = process.env.AGENTA_RIVET_DAYTONA_PI_DIR ?? "/home/sandbox/.pi/agent";
// The rivet `-full` image ships the pi-acp adapter but NOT the `pi` CLI, so by default we
// install it into the sandbox at session time and point pi-acp at it. A snapshot that
// pre-installs `pi` should set AGENTA_RIVET_DAYTONA_INSTALL_PI=false (faster, no per-run
// npm install). Version mirrors the wrapper's pinned Pi.
const DAYTONA_PI_INSTALL_DIR = "/home/sandbox/.agenta-pi";
const DAYTONA_PI_INSTALL = process.env.AGENTA_RIVET_DAYTONA_INSTALL_PI !== "false";
const DAYTONA_PI_VERSION = process.env.AGENTA_RIVET_PI_VERSION ?? "0.79.4";

/** Install the `pi` CLI into a Daytona sandbox (the rivet image lacks it). Best-effort. */
async function installPiInSandbox(sandbox: any): Promise<void> {
  try {
    await sandbox.mkdirFs({ path: DAYTONA_PI_INSTALL_DIR });
    const res = await sandbox.runProcess({
      command: "npm",
      args: [
        "install",
        "--no-fund",
        "--no-audit",
        `@earendil-works/pi-coding-agent@${DAYTONA_PI_VERSION}`,
      ],
      cwd: DAYTONA_PI_INSTALL_DIR,
      timeoutMs: 180_000,
    });
    if (res?.exitCode !== 0) {
      log(`pi install in sandbox exit=${res?.exitCode}: ${String(res?.stderr).slice(-400)}`);
    }
  } catch (err) {
    log(`pi install in sandbox skipped: ${(err as Error).message}`);
  }
}

/**
 * Upload the local Pi login into a Daytona sandbox so the remote Pi authenticates with
 * the dev's ChatGPT/Codex OAuth (it auto-refreshes from the token in auth.json). Must
 * `mkdirFs` the parent first (a fresh sandbox lacks it) and pass a string body — a
 * missing dir or a stream body is what produced the earlier "Stream Error". Best-effort:
 * with no local login the remote run falls back to any provider key in the sandbox env.
 */
async function uploadPiAuthToSandbox(sandbox: any): Promise<void> {
  const localDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi/agent");
  const authPath = join(localDir, "auth.json");
  if (!existsSync(authPath)) return;
  try {
    await sandbox.mkdirFs({ path: DAYTONA_PI_DIR });
    await sandbox.writeFsFile({ path: `${DAYTONA_PI_DIR}/auth.json` }, readFileSync(authPath, "utf-8"));
    const settingsPath = join(localDir, "settings.json");
    if (existsSync(settingsPath)) {
      await sandbox.writeFsFile(
        { path: `${DAYTONA_PI_DIR}/settings.json` },
        readFileSync(settingsPath, "utf-8"),
      );
    }
  } catch (err) {
    log(`pi auth upload skipped: ${(err as Error).message}`);
  }
}

/**
 * A `fetch` that persists cookies per host. Daytona's preview proxy authenticates with a
 * `daytona-sandbox-auth-*` cookie set on the first response; Node's fetch keeps no cookie
 * jar, so without this the proxy rejects later ACP requests with "Authentication
 * required" / 502. The rivet SDK accepts a custom fetch, so we hand it this one.
 */
function createCookieFetch(): typeof fetch {
  const jar = new Map<string, Map<string, string>>(); // host -> (name -> "name=value")
  return async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const host = url.host;
    const cookies = jar.get(host);
    const headers = new Headers(init?.headers ?? (typeof input !== "string" ? input.headers : undefined));
    if (cookies && cookies.size > 0) {
      const existing = headers.get("cookie");
      const merged = [...cookies.values()];
      if (existing) merged.unshift(existing);
      headers.set("cookie", merged.join("; "));
    }
    const response = await fetch(input, { ...init, headers });
    const setCookies =
      typeof (response.headers as any).getSetCookie === "function"
        ? (response.headers as any).getSetCookie()
        : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
    if (setCookies.length) {
      const store = jar.get(host) ?? new Map<string, string>();
      for (const sc of setCookies) {
        const pair = String(sc).split(";")[0];
        const name = pair.split("=")[0];
        if (name) store.set(name, pair);
      }
      jar.set(host, store);
    }
    return response;
  };
}

/** Read the run-total usage Pi wrote on agent_end (local fs or the sandbox FS API). */
async function readRunUsage(
  sandbox: any,
  path: string | undefined,
  isDaytona: boolean,
): Promise<AgentRunResult["usage"]> {
  if (!path) return undefined;
  try {
    let raw: string;
    if (isDaytona) {
      const bytes = await sandbox.readFsFile({ path });
      raw = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
    } else {
      if (!existsSync(path)) return undefined;
      raw = readFileSync(path, "utf-8");
    }
    const u = JSON.parse(raw);
    return u && u.total > 0 ? u : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Turn a harness/SDK error into one clear line for the caller (the playground shows it
 * verbatim), instead of dumping a full ACP/JS stack. Recognizes the common harness auth
 * failures so the user sees what to fix.
 */
function conciseError(err: unknown, harness: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.split("\n")[0].trim();
  const keyHint =
    harness === "claude" ? "the project's Anthropic key" : "the project's OpenAI key";
  if (/credit balance is too low/i.test(raw)) {
    return `${harness}: the model provider account has insufficient credit (check ${keyHint}).`;
  }
  if (/authentication required|invalid api key|401|unauthorized/i.test(raw)) {
    return `${harness}: model authentication failed — add ${keyHint} to the project vault, or log in (OAuth).`;
  }
  return msg || "agent run failed";
}

/**
 * Map a rivet `AgentInfo` to our capability flags. Falls back to a per-harness static
 * guess when the probe is unavailable, so tool delivery and tracing still pick a sane
 * path. Rivet has no `usage` capability flag (usage rides on `usage_update` events), so we
 * derive it from the harness: Pi reports usage through its extension, others over ACP.
 */
function mapCapabilities(harness: string, info: any): HarnessCapabilities {
  const c = info?.capabilities;
  if (c) {
    return {
      textMessages: c.textMessages ?? true,
      images: !!c.images,
      fileAttachments: !!c.fileAttachments,
      mcpTools: !!c.mcpTools,
      toolCalls: !!c.toolCalls,
      reasoning: !!c.reasoning,
      planMode: !!c.planMode,
      permissions: !!c.permissions,
      streamingDeltas: !!c.streamingDeltas,
      sessionLifecycle: !!c.sessionLifecycle,
      usage: true,
    };
  }
  // Static fallback by harness id: pi-acp does not forward MCP, Claude/Codex do.
  const isPiHarness = harness === "pi";
  return {
    textMessages: true,
    images: false,
    fileAttachments: false,
    mcpTools: !isPiHarness,
    toolCalls: true,
    reasoning: true,
    planMode: !isPiHarness,
    permissions: !isPiHarness,
    streamingDeltas: true,
    sessionLifecycle: true,
    usage: true,
  };
}

/** Probe the harness's capabilities from the daemon (best-effort, static fallback). */
async function probeCapabilities(
  sandbox: any,
  harness: string,
): Promise<HarnessCapabilities> {
  try {
    const info = await sandbox.getAgent(harness, { config: true });
    return mapCapabilities(harness, info);
  } catch {
    return mapCapabilities(harness, undefined);
  }
}

export async function runRivet(
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  const harness = request.harness || process.env.AGENTA_AGENT_HARNESS || "pi";
  const sandboxId = request.sandbox || process.env.AGENTA_AGENT_SANDBOX || "local";

  // The Agenta harness is Pi with an opinion: it runs on the `pi` ACP agent (the rivet
  // daemon only knows real agents like `pi`/`claude`, not `agenta`), plus a base AGENTS.md,
  // a persona, forced tools, and forced skills. `acpAgent` is the agent the daemon launches;
  // `harness` stays the selected identity (logging, span label, user-facing errors). The
  // forced skills are delivered below by laying them into the Pi agent dir.
  const acpAgent = harness === "agenta" ? "pi" : harness;

  const prompt = resolvePrompt(request);
  if (!prompt) {
    return { ok: false, error: "No user message to send (prompt/messages empty)." };
  }
  // What we actually send over ACP: the latest turn, with prior turns replayed as
  // context when this is a continued conversation.
  const turnText = buildTurnText(request);

  const isPi = acpAgent === "pi";
  const isDaytona = sandboxId === "daytona";

  // Provider API keys resolved from the vault (OPENAI_API_KEY/ANTHROPIC_API_KEY/...).
  // Present => the harness authenticates with the key; absent => it uses its own login
  // (OAuth: local Codex / a mounted-or-uploaded auth.json).
  const secrets = request.secrets ?? {};
  const harnessKeyVar = acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const hasApiKey = !!secrets[harnessKeyVar];

  // Session cwd holds AGENTS.md. Local: a host temp dir. Daytona: an in-sandbox path
  // (the host path would not exist on the remote sandbox).
  const cwd = isDaytona
    ? `/home/sandbox/agenta-${randomBytes(6).toString("hex")}`
    : mkdtempSync(join(tmpdir(), "agenta-rivet-"));
  const agentsMd = request.agentsMd?.trim();

  const toolSpecsForRun = (request.customTools as ResolvedToolSpec[]) ?? [];
  const executableToolSpecsForRun = executableToolSpecs(toolSpecsForRun);
  const relayDir = `${cwd}/.agenta-tools`;
  const useToolRelay = executableToolSpecsForRun.length > 0;

  // Pi writes its run totals here on agent_end; we read them back and return them so the
  // caller can roll them onto the workflow span (separate OTLP batch, see piExtension).
  const usageOutPath = isPi ? `${cwd}/.agenta-usage.json` : undefined;

  const env = buildDaemonEnv(acpAgent);
  Object.assign(env, secrets); // local daemon inherits the provider keys
  // Pi self-instruments locally: propagate the trace context + public tool metadata into Pi
  // via the Agenta extension. Tool execution always relays back to this runner, which keeps
  // private specs, scoped env, callback endpoints, and callback auth in memory.
  const piExtEnv = isPi
    ? buildPiExtensionEnv(request, !isDaytona, { relayDir, usageOutPath })
    : {};
  Object.assign(env, piExtEnv); // local daemon inherits it; daytona gets it via envVars
  // undefined is fine: the local provider runs its own resolution and errors clearly.
  const binaryPath = resolveDaemonBinary();

  // The Agenta harness's forced skills: bundled dirs named on the request, resolved against
  // the runner's skills root. Laid into the Pi agent dir's `skills/` below (local or daytona)
  // so Pi auto-discovers them on every run. Non-Pi harnesses do not load Pi skills.
  const skillDirs = isPi ? resolveSkillDirs(request.skills, log) : [];
  // Note: pass an arrow, not `basename` directly — Array.map would feed the index as
  // basename's `suffix` arg (a number), which throws ERR_INVALID_ARG_TYPE.
  if (skillDirs.length > 0) log(`skills: ${skillDirs.map((d) => basename(d)).join(", ")}`);

  // For local Pi, set up the agent dir pi-acp loads from. A plain `pi` run installs the
  // extension into the shared agent dir (unchanged). An Agenta run forces skills, which are
  // user-scope and would otherwise leak into later plain `pi` runs on this sidecar (and could
  // pollute a developer's real ~/.pi/agent); so it gets a throwaway per-run agent dir seeded
  // from the login, and the daemon is pointed at it. Cleaned up in the finally below.
  const localPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  let runAgentDir: string | undefined;
  if (isPi && !isDaytona) {
    if (skillDirs.length > 0) {
      runAgentDir = prepareLocalAgentDir(
        localPiAgentDir || join(homedir(), ".pi", "agent"),
        skillDirs,
      );
      env.PI_CODING_AGENT_DIR = runAgentDir;
    } else if (localPiAgentDir) {
      installPiExtensionLocal(localPiAgentDir);
    }
  }

  // Pi's system-prompt overrides (systemPrompt / appendSystemPrompt) are honored on the
  // in-process Pi engine via the resource loader. The ACP path drives Pi through pi-acp,
  // which gives us no per-run hook to set them (a project SYSTEM.md is trust-gated, and CLI
  // flags can't be set per session here), so they are not delivered yet. Warn rather than
  // drop them silently. AGENTS.md still applies on this path regardless.
  if (isPi && (request.systemPrompt?.trim() || request.appendSystemPrompt?.trim())) {
    log("systemPrompt/appendSystemPrompt are not yet delivered on the ACP (rivet) Pi path; ignored");
  }

  log(`harness=${harness} sandbox=${sandboxId} cwd=${cwd}`);

  // Persist events in-process so a follow-up turn can resume by session id.
  const persist = new InMemorySessionPersistDriver();
  const sandbox = await SandboxAgent.start({
    sandbox: buildSandboxProvider(sandboxId, env, binaryPath, piExtEnv, secrets),
    persist,
    // Propagate caller cancellation (a client disconnect on the streaming HTTP edge) so an
    // in-flight run aborts instead of finishing unobserved. The `finally` still disposes.
    ...(signal ? { signal } : {}),
    // Daytona's preview proxy authenticates with a per-sandbox cookie; carry it across
    // requests so ACP calls after the first don't 401. Harmless for local.
    ...(isDaytona ? { fetch: createCookieFetch() } : {}),
  });

  // Pi traces itself via the extension under the propagated traceparent; for other
  // harnesses we build the span tree here from the ACP event stream. Created below, once
  // the model is resolved, so the chat span carries the harness's actual model rather
  // than the requested one. Declared here so the catch can flush a partial trace.
  let otel: ReturnType<typeof createRivetOtel> | undefined;
  // Daytona tool relay loop (started once the session exists, stopped after the prompt).
  let toolRelay: { stop: () => Promise<void> } | undefined;

  try {
    // On Daytona, push the harness login, the extension, and AGENTS.md into the remote
    // sandbox via the filesystem API (nothing secret is baked into the image). Locally
    // these use the host filesystem and the harness's own login (PI_CODING_AGENT_DIR).
    if (isDaytona) {
      if (isPi) {
        // With a provider API key the harness authenticates via env; only fall back to
        // uploading the Codex/OAuth login when no key is available.
        if (!hasApiKey) await uploadPiAuthToSandbox(sandbox);
        await uploadPiExtensionToSandbox(sandbox, DAYTONA_PI_DIR);
        if (skillDirs.length > 0) await uploadSkillsToSandbox(sandbox, DAYTONA_PI_DIR, skillDirs);
        if (DAYTONA_PI_INSTALL) await installPiInSandbox(sandbox);
      }
      await sandbox.mkdirFs({ path: cwd }).catch(() => {});
      if (useToolRelay) await sandbox.mkdirFs({ path: relayDir }).catch(() => {});
      if (agentsMd) await sandbox.writeFsFile({ path: `${cwd}/AGENTS.md` }, agentsMd);
    } else {
      if (useToolRelay) mkdirSync(relayDir, { recursive: true });
      if (agentsMd) writeFileSync(join(cwd, "AGENTS.md"), agentsMd, "utf-8");
    }

    // Probe what this harness supports and branch on capabilities, not on the harness
    // name. Tool delivery: Pi loads our extension (native tools, set up above); any other
    // harness takes tools over MCP only when it advertises `mcpTools` (pi-acp does not
    // forward MCP, Claude/Codex do).
    const capabilities = await probeCapabilities(sandbox, acpAgent);
    const toolSpecs = (request.customTools as ResolvedToolSpec[]) ?? [];
    const userMcpCount = request.mcpServers?.length ?? 0;
    // MCP delivery is gated on `mcpTools`: pi-acp does not forward MCP, Claude/Codex do. The
    // synthesized `agenta-tools` server (gateway/code tools) and the user-declared servers
    // ride the same gate.
    const mcpServers =
      !isPi && capabilities.mcpTools
        ? [
            ...buildToolMcpServers(
              toolSpecs,
              request.toolCallback as ToolCallbackContext | undefined,
              relayDir,
            ),
            ...toAcpMcpServers(request.mcpServers),
          ]
        : [];
    if (!isPi && (toolSpecs.length > 0 || userMcpCount > 0) && !capabilities.mcpTools) {
      log(
        `harness '${harness}' lacks MCP support; ${toolSpecs.length} tool(s) and ` +
          `${userMcpCount} user MCP server(s) not delivered`,
      );
    }

    const session = await sandbox.createSession({
      agent: acpAgent,
      cwd,
      sessionInit: { cwd, mcpServers },
    });
    const sessionId = resolveRunSessionId(request, session.id);

    // Resolve the model first: when the harness rejects the requested id and keeps its
    // own default (e.g. Claude ignores "gpt-5.5"), `model` is undefined and the chat span
    // is labelled "chat" instead of falsely claiming the requested model.
    const model = await applyModel(session, request.model);

    const run = createRivetOtel({
      harness,
      model,
      traceparent: request.trace?.traceparent,
      baggage: request.trace?.baggage,
      endpoint: request.trace?.endpoint,
      authorization: request.trace?.authorization,
      captureContent: request.trace?.captureContent,
      emitSpans: !isPi || isDaytona,
      emit,
    });
    otel = run;

    run.start({
      prompt,
      sessionId,
      messages: [...priorMessages(request), { role: "user", content: prompt }],
    });

    session.onEvent((event: any) => {
      const payload = event?.payload;
      const update = payload?.params?.update ?? payload?.update;
      if (update) run.handleUpdate(update);
    });

    // Permission gating, behind the Responder seam. Pi never gates; a permission-gating
    // harness (e.g. Claude) raises a request, which we (a) surface as an `interaction_request`
    // event so the egress can project it (Vercel `tool-approval-request`) and the trace can
    // record it, and (b) resolve via the responder. The headless `PolicyResponder` keeps the
    // prior behavior: auto-allow trusted backend tools, or deny per `permissionPolicy` /
    // AGENTA_RIVET_DENY_PERMISSIONS. A cross-turn responder (true HITL) slots in here later
    // without touching the harness. Tools are backend-resolved and trusted; the run is headless.
    const responder: Responder = new PolicyResponder(policyFromRequest(request.permissionPolicy));
    session.onPermissionRequest((req: any) => {
      const id = String(req?.id ?? "");
      const availableReplies: string[] = req?.availableReplies ?? [];
      run.emitEvent({
        type: "interaction_request",
        id, // ACP permission id -> Vercel approvalId
        kind: "permission",
        payload: {
          // toolCallId of the gated tool, so the cross-turn approval reply correlates back to
          // its tool call (and the #6 resume finds it). `toolCall` is the ACP ToolCallUpdate.
          toolCallId: req?.toolCall?.toolCallId,
          toolCall: req?.toolCall,
          availableReplies,
          options: req?.options,
        },
      });
      void responder
        .onPermission({ id, availableReplies, raw: req })
        .then((decision) => {
          if (!req?.id) return;
          return session.respondPermission(req.id, decisionToReply(decision, availableReplies) as any);
        })
        .catch(() => {});
    });

    if (useToolRelay) {
      toolRelay = startToolRelay(
        isDaytona ? sandboxRelayHost(sandbox) : localRelayHost(),
        relayDir,
        toolSpecsForRun,
        request.toolCallback as ToolCallbackContext | undefined,
      );
    }

    const result = await session.prompt([{ type: "text", text: turnText }]);
    await toolRelay?.stop();
    const stopReason = (result as any)?.stopReason;
    log(`prompt stopReason=${stopReason}`);

    // Usage: Pi writes its totals to a file via the extension. Other harnesses report the
    // input/output token split on the PromptResponse and the cost on ACP `usage_update`,
    // so combine the two (the stream alone carries no per-call token split). Read and stamp
    // this before finish/flush so exported spans and final events carry the final usage.
    let usage = await readRunUsage(sandbox, usageOutPath, isDaytona);
    if (!usage) {
      const promptUsage = (result as any)?.usage;
      const streamUsage = run.usage();
      const inputTokens = promptUsage?.inputTokens ?? streamUsage?.input ?? 0;
      const outputTokens = promptUsage?.outputTokens ?? streamUsage?.output ?? 0;
      const total = inputTokens + outputTokens || streamUsage?.total || 0;
      const cost = streamUsage?.cost ?? 0;
      usage =
        total > 0 || cost > 0
          ? { input: inputTokens, output: outputTokens, total, cost }
          : undefined;
    }
    run.setUsage(usage);

    const output = run.finish();
    await run.flush();

    return {
      ok: true,
      output,
      messages: output ? [{ role: "assistant", content: output }] : [],
      // Streaming already delivered every event live, so the terminal result carries none
      // (re-sending would double them on the consumer).
      events: emit ? [] : run.events(),
      usage,
      stopReason,
      // `streamingDeltas` advertises end-to-end live deltas, which is only true when a live
      // sink is wired. The one-shot path reports false even when the harness produces deltas.
      capabilities: { ...capabilities, streamingDeltas: !!emit && capabilities.streamingDeltas },
      sessionId,
      model: model ?? request.model,
      traceId: run.traceId(),
    };
  } catch (err) {
    otel?.finish();
    await otel?.flush().catch(() => {});
    return { ok: false, error: conciseError(err, harness) };
  } finally {
    await toolRelay?.stop().catch(() => {});
    await sandbox.destroySandbox().catch(() => {});
    await sandbox.dispose().catch(() => {});
    rmSync(cwd, { recursive: true, force: true });
    // The per-run Agenta agent dir (skills isolation) is throwaway; remove it too.
    if (runAgentDir) rmSync(runAgentDir, { recursive: true, force: true });
  }
}
