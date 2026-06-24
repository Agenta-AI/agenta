import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AgentRunRequest,
  type McpServerConfig,
  type ResolvedToolSpec,
  type SandboxPermission,
  resolvePromptText,
} from "../../protocol.ts";
import { executableToolSpecs } from "../../tools/public-spec.ts";
import { MCP_UNSUPPORTED_MESSAGE } from "../../tools/mcp-bridge.ts";
import {
  type MaterializedSkill,
  resolveSkillDirs as defaultResolveSkillDirs,
} from "../skills.ts";
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
  createLocalCwd?: () => string;
  createDaytonaCwd?: () => string;
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

function defaultLocalCwd(): string {
  return mkdtempSync(join(tmpdir(), "agenta-sandbox-agent-"));
}

function defaultDaytonaCwd(): string {
  return `/home/sandbox/agenta-${randomBytes(6).toString("hex")}`;
}

export function buildRunPlan(
  request: AgentRunRequest,
  {
    sandboxProvider = process.env.SANDBOX_AGENT_PROVIDER,
    createLocalCwd = defaultLocalCwd,
    createDaytonaCwd = defaultDaytonaCwd,
    resolveSkillDirs = defaultResolveSkillDirs,
    log = () => {},
  }: BuildRunPlanDeps = {},
): BuildRunPlanResult {
  const harness = request.harness || "pi_core";
  const sandboxId = request.sandbox || sandboxProvider || "local";

  // The harness identity maps to a real ACP agent the daemon knows (`pi` / `claude`).
  // `pi_core` (plain Pi) and `pi_agenta` (Pi with Agenta's forced skills/prompt/policy) both
  // run on the `pi` ACP agent; `claude` runs on the `claude` ACP agent. `harness` remains the
  // selected identity for logs, traces, and user-facing errors.
  const acpAgent =
    harness === "pi_core" || harness === "pi_agenta" ? "pi" : harness;

  const prompt = resolvePromptText(request);
  if (!prompt) {
    return {
      ok: false,
      error: "No user message to send (prompt/messages empty).",
    };
  }

  const isPi = acpAgent === "pi";
  const isDaytona = sandboxId === "daytona";

  const secrets = request.secrets ?? {};
  const legacyHarnessApiKeyVar =
    acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
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
  // Daytona the policy IS applied (`provider.ts` `daytonaNetworkFields`).
  const network = request.sandboxPermission?.network;
  const networkRestricted = !!network && (network.mode ?? "on") !== "on";
  if (networkRestricted && !isDaytona) {
    return { ok: false, error: LOCAL_NETWORK_UNSUPPORTED_MESSAGE };
  }

  // stdio MCP servers run as arbitrary processes on the RUNNER HOST, outside the sandbox
  // boundary, and the sidecar's stdio MCP implementation is disabled (parity with the removed
  // code execution) until its security is fixed. Refuse any run carrying one, the way code
  // tools are gated — keep the wire shape, but the delivery is not supported.
  if (hasStdioMcpServer(request.mcpServers)) {
    return { ok: false, error: MCP_UNSUPPORTED_MESSAGE };
  }

  // Layer 2: even on Daytona, code/gateway tools run on the RUNNER HOST via the relay, not
  // inside the sandbox, so they bypass the sandbox network boundary. Under `strict` + a
  // restricted network, refuse them; `best_effort` is the opt-out that accepts the boundary is
  // not a hard guarantee.
  const strict = request.sandboxPermission?.enforcement === "strict";
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

  const cwd = isDaytona ? createDaytonaCwd() : createLocalCwd();
  const relayDir = `${cwd}/.agenta-tools`;

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

  return {
    ok: true,
    plan: {
      harness,
      acpAgent,
      sandboxId,
      isPi,
      isDaytona,
      prompt,
      turnText: buildTurnText(request),
      agentsMd: request.agentsMd?.trim() || undefined,
      secrets,
      legacyHarnessApiKeyVar,
      hasApiKey: !!secrets[legacyHarnessApiKeyVar],
      credentialMode: request.credentialMode,
      cwd,
      relayDir,
      usageOutPath: isPi ? `${cwd}/.agenta-usage.json` : undefined,
      toolSpecs,
      executableToolSpecs: executableToolSpecsForRun,
      useToolRelay: executableToolSpecsForRun.length > 0,
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
