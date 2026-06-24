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
import {
  type MaterializedSkill,
  resolveSkillDirs as defaultResolveSkillDirs,
} from "../skills.ts";
import { buildTurnText } from "./transcript.ts";

type Log = (message: string) => void;

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
   * Back-compat inputs to the OAuth-upload decision (see `shouldUploadOwnLogin`). `harnessKeyVar`
   * is no longer the AUTH driver (the provider is not guessed from the harness name anymore); it
   * only feeds the fallback `hasApiKey` heuristic for an un-migrated caller that sends no
   * `credentialMode`.
   */
  harnessKeyVar: string;
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
 * on the RUNNER HOST, so a network-blocked sandbox does not confine it.
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
  const harness = request.harness || "pi";
  const sandboxId = request.sandbox || sandboxProvider || "local";

  // The Agenta harness is Pi with an opinion: it runs on the `pi` ACP agent (the daemon only
  // knows real agents like `pi`/`claude`). `harness` remains the selected identity for logs,
  // traces, and user-facing errors.
  const acpAgent = harness === "agenta" ? "pi" : harness;

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
  // NOTE: the provider is no longer guessed from the harness name. `harnessKeyVar` survives only
  // as the back-compat input to `shouldUploadOwnLogin`'s fallback heuristic (an un-migrated caller
  // that sends no `credentialMode`); the primary OAuth-upload driver is `credentialMode`.
  const harnessKeyVar =
    acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const toolSpecs = (request.customTools as ResolvedToolSpec[]) ?? [];
  const executableToolSpecsForRun = executableToolSpecs(toolSpecs);

  // Layer 2 (S1b/S1g): enforce the declared network boundary, and fail loud where it cannot
  // be a hard guarantee. Only `strict` blocks; `best_effort` is the per-axis opt-out that
  // accepts the boundary may not hold. `mode: "on"` (or no policy) imposes no restriction.
  // Checked before any cwd is created so a rejected run does not orphan a temp dir.
  const network = request.sandboxPermission?.network;
  const networkRestricted = !!network && (network.mode ?? "on") !== "on";
  const strict = request.sandboxPermission?.enforcement === "strict";
  if (networkRestricted && strict) {
    const mode = network?.mode ?? "on";
    // Most specific first: the local sidecar has no egress control at all, so any restricted
    // network is unenforceable; Daytona applies it via networkBlockAll/networkAllowList.
    if (!isDaytona) {
      return {
        ok: false,
        error:
          `local sandbox cannot enforce network:${mode} (the local sidecar runs on this ` +
          `host with no egress control); set enforcement=best_effort to run locally without ` +
          `the guarantee, or run on daytona.`,
      };
    }
    // Even on Daytona, code/gateway tools and stdio MCP run on the RUNNER HOST via the relay,
    // not inside the sandbox, so they bypass the sandbox network boundary.
    if (
      executableToolSpecsForRun.length > 0 ||
      hasStdioMcpServer(request.mcpServers)
    ) {
      return {
        ok: false,
        error:
          `code/gateway tools and stdio MCP servers run on the runner host and would bypass ` +
          `the sandbox network boundary; remove them, or set enforcement=best_effort to accept ` +
          `that network:${mode} is not a hard guarantee.`,
      };
    }
  }

  const cwd = isDaytona ? createDaytonaCwd() : createLocalCwd();
  const relayDir = `${cwd}/.agenta-tools`;

  // Skills materialize as on-disk SKILL.md packages, which only the Pi runtime auto-discovers.
  // A non-Pi harness (the Claude SDK path, or any future ACP agent) cannot load SKILL.md, so we
  // drop the skills here rather than ship content the runtime never reads. The SDK's ClaudeHarness
  // adapter already empties `skills` for Claude, so this is also the backstop for any other non-Pi
  // harness whose skills still reached the wire. Either way the drop must be VISIBLE (per the
  // skills-config "per-harness mapping": log-and-drop, never silent), so warn with the count and
  // harness.
  let skillDirs: MaterializedSkill[];
  let skillsCleanup: () => void;
  if (isPi) {
    ({ skills: skillDirs, cleanup: skillsCleanup } = resolveSkillDirs(
      request.skills,
      log,
    ));
  } else {
    skillDirs = [];
    skillsCleanup = () => {};
    const droppedSkillCount = request.skills?.length ?? 0;
    if (droppedSkillCount > 0)
      log(
        `WARNING: dropping ${droppedSkillCount} skill(s) for harness "${harness}": ` +
          `its runtime cannot load SKILL.md (skills are a Pi-only capability).`,
      );
  }
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
      harnessKeyVar,
      hasApiKey: !!secrets[harnessKeyVar],
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
