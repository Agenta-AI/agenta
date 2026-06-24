import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AgentRunRequest,
  type ResolvedToolSpec,
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
  harnessKeyVar: string;
  hasApiKey: boolean;
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
    return { ok: false, error: "No user message to send (prompt/messages empty)." };
  }

  const isPi = acpAgent === "pi";
  const isDaytona = sandboxId === "daytona";
  const cwd = isDaytona ? createDaytonaCwd() : createLocalCwd();
  const relayDir = `${cwd}/.agenta-tools`;

  const secrets = request.secrets ?? {};
  const harnessKeyVar = acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const toolSpecs = (request.customTools as ResolvedToolSpec[]) ?? [];
  const executableToolSpecsForRun = executableToolSpecs(toolSpecs);

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

  const systemPrompt = isPi ? request.systemPrompt?.trim() || undefined : undefined;
  const appendSystemPrompt = isPi ? request.appendSystemPrompt?.trim() || undefined : undefined;

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
    },
  };
}
