import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  type AgentRunRequest,
  type ResolvedToolSpec,
  resolvePromptText,
} from "../../protocol.ts";
import { executableToolSpecs } from "../../tools/public-spec.ts";
import { resolveSkillDirs as defaultResolveSkillDirs } from "../skills.ts";
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
  skillDirs: string[];
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
  const skillDirs = isPi ? resolveSkillDirs(request.skills, log) : [];
  if (skillDirs.length > 0) log(`skills: ${skillDirs.map((d) => basename(d)).join(", ")}`);

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
      sourcePiAgentDir:
        process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
    },
  };
}
