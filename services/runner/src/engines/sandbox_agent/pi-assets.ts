import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { AgentRunRequest, ResolvedToolSpec } from "../../protocol.ts";
import { advertisedToolSpecs } from "../../tools/public-spec.ts";
import type { MaterializedSkill } from "../skills.ts";
import { PKG_ROOT } from "./daemon.ts";
import type { RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

// The bundled Agenta Pi extension (tracing + tools). Built by `pnpm run build:extension`
// and baked into the image; installed into Pi's agent dir so Pi loads it on every run.
export const EXTENSION_BUNDLE =
  process.env.SANDBOX_AGENT_EXTENSION_BUNDLE ??
  join(PKG_ROOT, "dist", "extensions", "agenta.js");

/**
 * Env the Agenta Pi extension reads. Tool env contains only public metadata plus the
 * relay directory; private specs/auth stay in the runner.
 */
export function buildPiExtensionEnv(
  request: AgentRunRequest,
  tracing: boolean,
  opts: {
    relayDir?: string;
    usageOutPath?: string;
    skills?: string[];
    builtinGatingActive?: boolean;
    builtinGrants?: string[];
  } = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const propagation = tracing ? request.context?.propagation : undefined;
  const telemetry = tracing ? request.telemetry : undefined;
  const otlp = telemetry?.exporters?.otlp;
  if (propagation?.traceparent) env.TRACEPARENT = propagation.traceparent;
  if (otlp?.endpoint) env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = otlp.endpoint;
  if (otlp?.headers?.authorization)
    env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=${otlp.headers.authorization}`;
  if (telemetry?.capture?.content?.enabled === false)
    env.AGENTA_AGENT_CONTENT_CAPTURE_ENABLED = "false";
  // The skills that materialized for this run (author + forced `_agenta.*`), so Pi's own agent
  // span records which skills loaded (F-029). Only set under tracing (the extension's only span
  // consumer); a JSON array string the extension parses.
  if (telemetry && opts.skills && opts.skills.length > 0)
    env.AGENTA_AGENT_SKILLS_LOADED = JSON.stringify(opts.skills);

  const specs = advertisedToolSpecs(
    (request.customTools as ResolvedToolSpec[]) ?? [],
  );
  if (specs.length && opts.relayDir) {
    env.AGENTA_AGENT_TOOLS_PUBLIC_SPECS = JSON.stringify(specs);
    env.AGENTA_AGENT_TOOLS_RELAY_DIR = opts.relayDir;
  }
  if (opts.builtinGatingActive) {
    env.AGENTA_AGENT_BUILTIN_GATING = "1";
    env.AGENTA_AGENT_BUILTIN_GRANTS = (opts.builtinGrants ?? []).join(",");
    if (opts.relayDir) env.AGENTA_AGENT_TOOLS_RELAY_DIR = opts.relayDir;
  }
  if (opts.usageOutPath)
    env.AGENTA_AGENT_USAGE_CAPTURE_PATH = opts.usageOutPath;
  return env;
}

/** Install the extension bundle into a local Pi agent dir's extensions/. Best-effort. */
export function installPiExtensionLocal(
  agentDir: string,
  log: Log = () => {},
): void {
  if (!existsSync(EXTENSION_BUNDLE)) {
    log(
      `pi extension bundle missing at ${EXTENSION_BUNDLE} (run build:extension)`,
    );
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

/**
 * Pi reads system-prompt files from the non-trust-gated agent dir. Only call this on a
 * throwaway per-run agent dir so prompts cannot leak into later runs.
 */
export function writeSystemPromptLocal(
  agentDir: string,
  systemPrompt: string | undefined,
  appendSystemPrompt: string | undefined,
  log: Log = () => {},
): void {
  try {
    mkdirSync(agentDir, { recursive: true });
    if (systemPrompt)
      writeFileSync(join(agentDir, "SYSTEM.md"), systemPrompt, "utf-8");
    if (appendSystemPrompt) {
      writeFileSync(
        join(agentDir, "APPEND_SYSTEM.md"),
        appendSystemPrompt,
        "utf-8",
      );
    }
  } catch (err) {
    log(`system prompt write skipped: ${(err as Error).message}`);
  }
}

/** Upload the system/append-system prompts into a Daytona sandbox's Pi agent dir. */
export async function uploadSystemPromptToSandbox(
  sandbox: any,
  agentDir: string,
  systemPrompt: string | undefined,
  appendSystemPrompt: string | undefined,
  log: Log = () => {},
): Promise<void> {
  try {
    await sandbox.mkdirFs({ path: agentDir });
    if (systemPrompt) {
      await sandbox.writeFsFile(
        { path: `${agentDir}/SYSTEM.md` },
        systemPrompt,
      );
    }
    if (appendSystemPrompt) {
      await sandbox.writeFsFile(
        { path: `${agentDir}/APPEND_SYSTEM.md` },
        appendSystemPrompt,
      );
    }
  } catch (err) {
    log(`system prompt upload skipped: ${(err as Error).message}`);
  }
}

/** Upload the extension bundle into a Daytona sandbox's Pi extensions dir. Best-effort. */
export async function uploadPiExtensionToSandbox(
  sandbox: any,
  agentDir: string,
  log: Log = () => {},
): Promise<void> {
  if (!existsSync(EXTENSION_BUNDLE)) return;
  try {
    const dir = `${agentDir}/extensions`;
    await sandbox.mkdirFs({ path: dir });
    await sandbox.writeFsFile(
      { path: `${dir}/agenta.js` },
      readFileSync(EXTENSION_BUNDLE, "utf-8"),
    );
  } catch (err) {
    log(`pi extension upload skipped: ${(err as Error).message}`);
  }
}

/** Install materialized skill dirs into a local Pi agent dir's user-scope `skills/`. */
export function installSkillsLocal(
  agentDir: string,
  skillDirs: MaterializedSkill[],
  log: Log = () => {},
): void {
  for (const skill of skillDirs) {
    try {
      const dest = join(agentDir, "skills", skill.name);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(skill.dir, dest, { recursive: true, dereference: true });
    } catch (err) {
      log(`skill install skipped for ${skill.name}: ${(err as Error).message}`);
    }
  }
}

/**
 * Seed a throwaway local Pi agent dir from `sourceAgentDir` and install the Agenta extension
 * plus the run's materialized skills into it.
 */
export function prepareLocalAgentDir(
  sourceAgentDir: string,
  skillDirs: MaterializedSkill[],
  log: Log = () => {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-pi-agentdir-"));
  for (const name of ["auth.json", "settings.json"]) {
    const src = join(sourceAgentDir, name);
    try {
      if (existsSync(src)) copyFileSync(src, join(dir, name));
    } catch (err) {
      log(`agent-dir seed skipped for ${name}: ${(err as Error).message}`);
    }
  }
  installPiExtensionLocal(dir, log);
  installSkillsLocal(dir, skillDirs, log);
  return dir;
}

export interface PrepareLocalPiAssetsInput {
  plan: Pick<
    RunPlan,
    | "isPi"
    | "isDaytona"
    | "skillDirs"
    | "hasSystemPrompt"
    | "systemPrompt"
    | "appendSystemPrompt"
    | "sourcePiAgentDir"
  >;
  env: Record<string, string>;
  log?: Log;
}

/**
 * Prepare local Pi's agent dir assets and return the throwaway per-run dir when one was
 * created. Skills and system prompts always use an isolated dir; plain Pi runs only install
 * the inert Agenta extension into the configured shared dir.
 */
export function prepareLocalPiAssets({
  plan,
  env,
  log = () => {},
}: PrepareLocalPiAssetsInput): string | undefined {
  if (!plan.isPi || plan.isDaytona) return undefined;

  if (plan.skillDirs.length > 0 || plan.hasSystemPrompt) {
    const runAgentDir = prepareLocalAgentDir(
      plan.sourcePiAgentDir,
      plan.skillDirs,
      log,
    );
    if (plan.hasSystemPrompt) {
      writeSystemPromptLocal(
        runAgentDir,
        plan.systemPrompt,
        plan.appendSystemPrompt,
        log,
      );
    }
    env.PI_CODING_AGENT_DIR = runAgentDir;
    return runAgentDir;
  }

  if (process.env.PI_CODING_AGENT_DIR) {
    installPiExtensionLocal(process.env.PI_CODING_AGENT_DIR, log);
  }
  return undefined;
}

/** Upload materialized skill dirs into a Daytona sandbox's Pi `skills/` user scope. */
export async function uploadSkillsToSandbox(
  sandbox: any,
  agentDir: string,
  skillDirs: MaterializedSkill[],
  log: Log = () => {},
): Promise<void> {
  for (const skill of skillDirs) {
    try {
      await uploadDirToSandbox(
        sandbox,
        skill.dir,
        `${agentDir}/skills/${skill.name}`,
      );
    } catch (err) {
      log(`skill upload skipped for ${skill.name}: ${(err as Error).message}`);
    }
  }
}

/** Recursively upload a host directory tree into a sandbox path via the FS API. */
export async function uploadDirToSandbox(
  sandbox: any,
  srcDir: string,
  destDir: string,
): Promise<void> {
  await sandbox.mkdirFs({ path: destDir });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = `${destDir}/${entry.name}`;
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
      await sandbox.writeFsFile(
        { path: destPath },
        readFileSync(srcPath, "utf-8"),
      );
    }
  }
}
