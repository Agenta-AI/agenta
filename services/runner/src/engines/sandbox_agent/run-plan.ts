import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  type AgentRunRequest,
  type McpServerConfig,
  type ResolvedToolSpec,
  type SandboxPermission,
  resolvePromptText,
} from "../../protocol.ts";
import { executableToolSpecs } from "../../tools/public-spec.ts";
import { CODE_TOOL_UNSUPPORTED_MESSAGE } from "../../tools/code.ts";
import {
  PI_USER_MCP_UNSUPPORTED_MESSAGE,
  USER_MCP_UNSUPPORTED_MESSAGE,
} from "../../tools/mcp-bridge.ts";
import {
  type MaterializedSkill,
  resolveSkillDirs as defaultResolveSkillDirs,
} from "../skills.ts";
import { assert } from "./capabilities.ts";
import { buildTurnText } from "./transcript.ts";

type Log = (message: string) => void;

/**
 * Not-implemented sandbox-boundary gates. These mirror the code-tool gate
 * (`tools/code.ts` `CODE_TOOL_UNSUPPORTED_MESSAGE`): a declared capability the runner cannot
 * actually enforce fails loudly with a single named-constant message rather than being silently
 * accepted, so a run never proceeds believing a boundary holds when it does not.
 */

/** A restricted `network` policy on the LOCAL sandbox is not enforceable (no host egress control). */
export const LOCAL_NETWORK_UNSUPPORTED_MESSAGE =
  "Network sandbox policy is not enforceable on the local sandbox (the sidecar runs on this " +
  "host with no egress control); run on daytona, or remove sandbox_permission.network.";

/** A restricted `network` policy on E2B is not enforceable (the e2b provider exposes no egress control). */
export const E2B_NETWORK_UNSUPPORTED_MESSAGE =
  "Network sandbox policy is not enforceable on the e2b sandbox (the sandbox-agent/e2b " +
  "provider exposes no egress control); run on daytona, or remove sandbox_permission.network.";

/** `filesystem` confinement is declared on the wire but applied by no backend. */
export const FILESYSTEM_UNSUPPORTED_MESSAGE =
  "Filesystem sandbox policy is not implemented (no backend applies a filesystem jail); " +
  "remove sandbox_permission.filesystem.";

export interface RunPlan {
  harness: string;
  acpAgent: string;
  sandboxId: string;
  isPi: boolean;
  isDaytona: boolean;
  isE2B: boolean;
  /** True for any remote sandbox (`isDaytona || isE2B`); use for remoteness-only checks. */
  isRemoteSandbox: boolean;
  prompt: string;
  turnText: string;
  agentsMd?: string;
  secrets: Record<string, string>;
  /**
   * Back-compat inputs to the OAuth-upload decision (see `shouldUploadOwnLogin`). `legacyHarnessApiKeyVar`
   * does not choose the provider; it only feeds the fallback `hasApiKey` heuristic for an un-migrated caller that sends no
   * `credentialMode`.
   */
  legacyHarnessApiKeyVar: string;
  hasApiKey: boolean;
  /**
   * How the credential is delivered: "env" (managed, resolved key) | "runtime_provided" (the
   * harness owns its login) | "none". From the resolved connection (provider-model-auth design,
   * Concern 3). `undefined` when an un-migrated caller sends no credentialMode; the run then
   * falls back to the `hasApiKey` heuristic. Drives clear-then-apply env (Security rule 5) and
   * the OAuth-upload gate (rule 6).
   */
  credentialMode?: string;
  cwd: string;
  relayDir: string;
  usageOutPath?: string;
  toolSpecs: ResolvedToolSpec[];
  executableToolSpecs: ResolvedToolSpec[];
  useToolRelay: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  hasSystemPrompt: boolean;
  skillDirs: MaterializedSkill[];
  /** Removes the per-run skills temp root. The engine runs it in its `finally` so it never leaks. */
  skillsCleanup: () => void;
  sourcePiAgentDir: string;
  /**
   * The declared sandbox security boundary (Layer 2). `buildSandboxProvider` enforces the
   * network policy on Daytona (S1b); `buildRunPlan` rejects restricted-network runs the
   * provider cannot make a hard guarantee for (local sidecar, or runner-host tools / stdio
   * MCP) when `enforcement === "strict"`.
   */
  sandboxPermission?: SandboxPermission;
  /**
   * Generic harness-rendered files to materialize in the cwd before the session starts. Each
   * `{ path (relative to cwd), content }` was produced by the Python harness adapter (e.g. the
   * claude adapter renders `.claude/settings.json` from its permissions slice). `prepareWorkspace`
   * writes each entry blind — no harness knowledge on the runner.
   */
  harnessFiles?: Array<{ path: string; content: string }>;
}

export type BuildRunPlanResult =
  | { ok: true; plan: RunPlan }
  | { ok: false; error: string };

export interface BuildRunPlanDeps {
  sandboxProvider?: string;
  createLocalCwd?: (durableCwd?: string) => string;
  createDaytonaCwd?: (durableCwd?: string) => string;
  createE2BCwd?: () => string;
  /** Pre-computed durable cwd derived from the sign prefix; when set, skips the ephemeral helpers. */
  durableCwd?: string;
  resolveSkillDirs?: typeof defaultResolveSkillDirs;
  log?: Log;
}

/**
 * True when an MCP server runs as a host command (stdio) rather than a remote URL. Mirrors
 * the delivery rule in `mcp.ts` (`toAcpMcpServers`): the default transport is `stdio`, and a
 * stdio server only runs when it carries a `command`. Such a server is an arbitrary process
 * on the RUNNER HOST, so a network-blocked sandbox does not confine it. HTTP servers
 * (`transport: "http"`) are delivered (the harness connects to the remote URL with the secret
 * in a header) and are NOT flagged here — they have no runner-host process to confine.
 */
function hasStdioMcpServer(servers: McpServerConfig[] | undefined): boolean {
  return (servers ?? []).some(
    (s) => (s.transport ?? "stdio") === "stdio" && !!s.command,
  );
}

/**
 * True when any resolved tool is a `code` tool. Code execution was removed for security
 * (F-010); the sidecar must refuse a run that carries one rather than advertise it and then
 * launder a per-call rejection into a "successful" reply (F-016).
 */
function hasCodeTool(specs: ResolvedToolSpec[]): boolean {
  return specs.some((spec) => spec.kind === "code");
}

function defaultLocalCwd(durableCwd?: string): string {
  // When the caller pre-computed a durable cwd from the sign prefix, use it — same prefix means
  // same mountpoint across turns, so checkMounted short-circuits and no geesefs leak accrues.
  if (durableCwd) {
    mkdirSync(durableCwd, { recursive: true });
    return durableCwd;
  }
  // Ephemeral fallback for non-session runs.
  return mkdtempSync(join(tmpdir(), "agenta-sandbox-agent-"));
}

function defaultDaytonaCwd(durableCwd?: string): string {
  // Daytona: the remote sandbox creates the dir via mkdir-p in mountStorageRemote; no mkdirSync.
  return durableCwd ?? `/home/sandbox/agenta-${randomBytes(6).toString("hex")}`;
}

function defaultE2BCwd(): string {
  return `/root/work/agenta-${randomBytes(6).toString("hex")}`;
}

export function buildRunPlan(
  request: AgentRunRequest,
  {
    sandboxProvider = process.env.SANDBOX_AGENT_PROVIDER,
    createLocalCwd = defaultLocalCwd,
    createDaytonaCwd = defaultDaytonaCwd,
    createE2BCwd = defaultE2BCwd,
    durableCwd,
    resolveSkillDirs = defaultResolveSkillDirs,
    log = () => {},
  }: BuildRunPlanDeps = {},
): BuildRunPlanResult {
  const harness = request.harness || "pi_core";
  const sandboxId = request.sandbox || sandboxProvider || "local";

  // The harness identity maps to a real ACP agent the daemon knows (`pi` / `claude` / `codex`).
  // `pi_core` and `pi_agenta` both drive the `pi` ACP agent; `claude` and `codex` drive their
  // own. `harness` stays the selected identity for logs, traces, and user-facing errors.
  const acpAgent =
    harness === "pi_core" || harness === "pi_agenta" ? "pi" : harness;

  // Debug assertion: every `pi_*` harness must resolve to the `pi` ACP agent (catches a future
  // pi_* typo); non-pi harnesses pass through unchanged.
  assert(
    harness.startsWith("pi_") === (acpAgent === "pi"),
    `harness '${harness}' resolved to ACP agent '${acpAgent}', but pi identity mapping disagrees`,
  );

  const prompt = resolvePromptText(request);
  if (!prompt) {
    return {
      ok: false,
      error: "No user message to send (prompt/messages empty).",
    };
  }

  const isPi = acpAgent === "pi";
  const isDaytona = sandboxId === "daytona";
  const isE2B = sandboxId === "e2b";
  const isRemoteSandbox = isDaytona || isE2B;

  const secrets = request.secrets ?? {};
  const legacyHarnessApiKeyVar =
    acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"; // codex uses OPENAI_API_KEY
  const toolSpecs = (request.customTools as ResolvedToolSpec[]) ?? [];
  const executableToolSpecsForRun = executableToolSpecs(toolSpecs);

  // Not-implemented boundary gates (sidecar-trust Part 2): a declared capability the runner
  // cannot actually enforce fails loudly, the way code tools do (`tools/code.ts`), rather than
  // being silently accepted. These fire BEFORE any cwd is created (so a rejected run never
  // orphans a temp dir) and are unconditional — `enforcement` is no longer the escape hatch,
  // because the boundary is not applied on any path regardless of strict/best_effort.

  // `filesystem` confinement is declared on the wire but applied by no backend. Specifying it
  // therefore errors everywhere; do not pretend a jail exists.
  if (request.sandboxPermission?.filesystem !== undefined) {
    return { ok: false, error: FILESYSTEM_UNSUPPORTED_MESSAGE };
  }

  // A restricted `network` policy on the LOCAL sandbox cannot be enforced (the sidecar runs on
  // this host with no per-run egress control), so it errors regardless of `enforcement`. On
  // Daytona the policy IS applied (`provider.ts` `daytonaNetworkFields`). E2B exposes no egress
  // control in the sandbox-agent/e2b wrapper, so it is refused like local.
  const network = request.sandboxPermission?.network;
  const networkRestricted = !!network && (network.mode ?? "on") !== "on";
  if (networkRestricted && isE2B) {
    return { ok: false, error: E2B_NETWORK_UNSUPPORTED_MESSAGE };
  }
  if (networkRestricted && !isDaytona && !isE2B) {
    return { ok: false, error: LOCAL_NETWORK_UNSUPPORTED_MESSAGE };
  }

  // Code tools were removed (F-010 security): the sidecar no longer executes author-supplied
  // snippets. `runCodeTool` throws per-call, but a per-call throw becomes a tool RESULT the
  // model launders into an `ok:true` reply ("Code tools are not supported by the sidecar."),
  // so a removed capability reads as a SUCCESS at the response envelope (F-016). Fail loud
  // up-front instead: refuse any run that carries a `code` tool, the way stdio MCP is gated.
  // Keep the wire shape; the delivery is not supported.
  if (hasCodeTool(toolSpecs)) {
    return { ok: false, error: CODE_TOOL_UNSUPPORTED_MESSAGE };
  }

  // Pi delivers tools through its bundled extension, not over ACP MCP, so a user MCP server on
  // a Pi run is DROPPED by `buildSessionMcpServers` (it returns [] for Pi). Dropping it silently
  // (no log, HTTP 200) is the F-032 silent-drop bug. Refuse ANY user MCP server (stdio AND http)
  // on Pi up front with a Pi-specific message, the way the stdio-MCP and code-tool gates fail
  // loud. This MUST precede the harness-agnostic stdio gate so Pi gets the clearer reason for
  // both transports (http MCP is otherwise a Claude-only capability, #4834).
  if (isPi && (request.mcpServers?.length ?? 0) > 0) {
    return { ok: false, error: PI_USER_MCP_UNSUPPORTED_MESSAGE };
  }

  // stdio MCP servers run as arbitrary processes on the RUNNER HOST, outside the sandbox
  // boundary, and the sidecar's stdio MCP implementation is disabled (parity with the removed
  // code execution) until its security is fixed. Refuse any run carrying one, the way code
  // tools are gated — keep the wire shape, but the delivery is not supported.
  if (hasStdioMcpServer(request.mcpServers)) {
    return { ok: false, error: USER_MCP_UNSUPPORTED_MESSAGE };
  }

  // Layer 2: even on Daytona, code/gateway tools run on the RUNNER HOST via the relay, not
  // inside the sandbox, so they bypass the sandbox network boundary. Under `strict` + a
  // restricted network, refuse them; `best_effort` is the opt-out that accepts the boundary is
  // not a hard guarantee.
  // Default to strict when `enforcement` is omitted, matching the documented wire schema
  // (`WireSandboxPermission.enforcement` defaults to "strict"). The Python service always fills
  // "strict", so the live path is unchanged; this aligns a DIRECT runner caller (and the
  // omit-when-default goldens) so only an explicit "best_effort" opts out of the hard guarantee.
  const strict = request.sandboxPermission?.enforcement !== "best_effort";
  if (networkRestricted && isDaytona && strict) {
    const mode = network?.mode ?? "on";
    if (executableToolSpecsForRun.length > 0) {
      return {
        ok: false,
        error:
          `code/gateway tools run on the runner host and would bypass the sandbox network ` +
          `boundary; remove them, or set enforcement=best_effort to accept that ` +
          `network:${mode} is not a hard guarantee.`,
      };
    }
  }

  const cwd = isDaytona
    ? createDaytonaCwd(durableCwd)
    : isE2B
      ? createE2BCwd()
      : createLocalCwd(durableCwd);
  // The tool-relay scratch (req/res JSON) is ephemeral runner<->child IPC, NOT durable session
  // data — keep it OFF the geesefs-mounted cwd. A relay dir inside the mount routes every tool
  // call through FUSE/S3, so a flaky mount surfaces as ENOTCONN on the relay file. Use an
  // ephemeral sibling: a plain host tmp dir (local) or an in-VM dir (daytona), never the mount.
  // E2B's cwd is never geesefs-mounted and its relay is polled via the sandbox FS API, so it
  // nests under the cwd.
  const relayDir = isE2B
    ? `${cwd}/.agenta-tools`
    : join(
        isDaytona ? "/home/sandbox/agenta/relay" : join(tmpdir(), "agenta", "relay"),
        basename(cwd),
      );

  // Skills materialize once from the resolved inline packages. Pi/Agenta consume the dirs
  // through Pi's agent-dir user scope; Claude consumes the same packages from the project-local
  // `.claude/skills` tree that `prepareWorkspace` writes below.
  const { skills: skillDirs, cleanup: skillsCleanup } = resolveSkillDirs(
    request.skills,
    log,
  );
  if (skillDirs.length > 0)
    log(`skills: ${skillDirs.map((s) => s.name).join(", ")}`);

  const systemPrompt = isPi
    ? request.systemPrompt?.trim() || undefined
    : undefined;
  const appendSystemPrompt = isPi
    ? request.appendSystemPrompt?.trim() || undefined
    : undefined;

  // Debug assertions: the derived run state must be self-consistent before the engine acts on
  // it. A cwd that is empty, or a relay dir not nested under it, would only surface later as a
  // confusing filesystem error inside the sandbox.
  assert(!!cwd, `buildRunPlan produced an empty cwd for harness '${harness}'`);
  assert(
    !!relayDir && relayDir !== cwd,
    `relay dir '${relayDir}' must be a distinct ephemeral dir, not the durable cwd`,
  );
  assert(
    isPi === (acpAgent === "pi"),
    `isPi (${isPi}) disagrees with acpAgent '${acpAgent}'`,
  );

  return {
    ok: true,
    plan: {
      harness,
      acpAgent,
      sandboxId,
      isPi,
      isDaytona,
      isE2B,
      isRemoteSandbox,
      prompt,
      turnText: buildTurnText(request),
      agentsMd: request.agentsMd?.trim() || undefined,
      secrets,
      legacyHarnessApiKeyVar,
      hasApiKey: !!secrets[legacyHarnessApiKeyVar],
      credentialMode: request.credentialMode,
      cwd,
      relayDir,
      // Usage capture is ephemeral runner output, not durable session data — keep it off the
      // geesefs mount alongside the relay dir (a mount write would risk ENOTCONN).
      usageOutPath: isPi ? join(relayDir, ".agenta-usage.json") : undefined,
      toolSpecs,
      executableToolSpecs: executableToolSpecsForRun,
      useToolRelay: toolSpecs.length > 0,
      systemPrompt,
      appendSystemPrompt,
      hasSystemPrompt: !!(systemPrompt || appendSystemPrompt),
      skillDirs,
      skillsCleanup,
      sourcePiAgentDir:
        process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
      sandboxPermission: request.sandboxPermission,
      // Generic: the Python harness adapter already rendered any harness config files; the runner
      // just carries them onto the plan and writes them into the cwd in `prepareWorkspace`.
      harnessFiles: request.harnessFiles,
    },
  };
}

/**
 * Whether to upload Pi's fallback `auth.json` (the harness's own OAuth login) into the run.
 *
 * The provider-model-auth design (Security rule 6) gates this on the harness owning its login,
 * NOT on a provider guessed from the harness name:
 *  - `credentialMode === "env"` (a resolved key): NEVER upload the fallback (the resolved key is
 *    the credential).
 *  - `credentialMode === "runtime_provided"`: upload (the harness authenticates with its login).
 *  - `credentialMode === "none"`: do not upload (no credential asserted).
 *  - no `credentialMode` on the wire (un-migrated caller): fall back to today's heuristic —
 *    upload only when no api key was supplied (`!hasApiKey`).
 */
export function shouldUploadOwnLogin(
  plan: Pick<RunPlan, "credentialMode" | "hasApiKey">,
): boolean {
  if (plan.credentialMode === "runtime_provided") return true;
  if (plan.credentialMode) return false; // "env" / "none": a resolved decision, never upload
  return !plan.hasApiKey; // back-compat: un-migrated caller, no credentialMode
}
