import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
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

/**
 * Pi native transcripts belong to the Agenta conversation, not the temporary Pi agent dir.
 * The session cwd is already the durable, session-scoped workspace on both local and Daytona
 * runs, so keeping transcripts below it gives Pi a stable path without persisting credentials,
 * settings, extensions, or system prompts.
 */
export function piSessionWorkspaceDir(cwd: string): string {
  return join(cwd, "agents", "sessions", "pi");
}

/** Point Pi at the durable conversation-scoped transcript directory. */
export function configurePiSessionWorkspace(
  plan: Pick<RunPlan, "isPi" | "cwd">,
  env: Record<string, string>,
): string | undefined {
  if (!plan.isPi) return undefined;
  const sessionDir = piSessionWorkspaceDir(plan.cwd);
  env.PI_CODING_AGENT_SESSION_DIR = sessionDir;
  return sessionDir;
}

export const PI_SKILL_SNAPSHOT_MARKER = ".agenta-skill-set.json";

export interface PiSkillSnapshot {
  digest: string;
  dir: string;
  marker: string;
  skills: MaterializedSkill[];
}

interface SkillFile {
  path: string;
  mode: number;
  content: Buffer;
}

function listSkillFiles(dir: string, relativeDir = ""): SkillFile[] {
  const files: SkillFile[] = [];
  for (const entry of readdirSync(join(dir, relativeDir), {
    withFileTypes: true,
  }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    const sourcePath = join(dir, relativePath);
    const stat = entry.isSymbolicLink() ? statSync(sourcePath) : undefined;
    if (entry.isDirectory() || stat?.isDirectory()) {
      files.push(...listSkillFiles(dir, relativePath));
    } else if (entry.isFile() || stat?.isFile()) {
      files.push({
        path: relativePath,
        mode: statSync(sourcePath).mode & 0o777,
        content: readFileSync(sourcePath),
      });
    }
  }
  return files;
}

function hashPart(
  hash: ReturnType<typeof createHash>,
  value: string | Buffer,
): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf-8") : value;
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

/** Resolve the immutable project-local snapshot selected for this Pi run. */
export function resolvePiSkillSnapshot(
  plan: Pick<RunPlan, "isPi" | "cwd" | "skillDirs">,
): PiSkillSnapshot | undefined {
  if (!plan.isPi || plan.skillDirs.length === 0) return undefined;

  const skills = [...plan.skillDirs].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const hash = createHash("sha256");
  hashPart(hash, "agenta-pi-skill-set-v1");
  for (const skill of skills) {
    hashPart(hash, skill.name);
    for (const file of listSkillFiles(skill.dir)) {
      hashPart(hash, file.path);
      hashPart(hash, file.mode.toString(8));
      hashPart(hash, file.content);
    }
  }
  const digest = hash.digest("hex");
  const marker = `${JSON.stringify({
    version: 1,
    digest,
    skills: skills.map((skill) => skill.name),
  })}\n`;
  return {
    digest,
    dir: join(plan.cwd, "agents", "skills", digest),
    marker,
    skills,
  };
}

/** Tell Pi to load only the explicitly selected project-local snapshot. */
export function configurePiSkillSnapshot(
  snapshot: PiSkillSnapshot | undefined,
  env: Record<string, string>,
): void {
  if (snapshot) env.PI_CODING_AGENT_SKILL_DIR = snapshot.dir;
}

function validateLocalPiSkillSnapshot(snapshot: PiSkillSnapshot): boolean {
  if (!existsSync(snapshot.dir)) return false;
  const markerPath = join(snapshot.dir, PI_SKILL_SNAPSHOT_MARKER);
  if (
    !existsSync(markerPath) ||
    readFileSync(markerPath, "utf-8") !== snapshot.marker
  ) {
    throw new Error(
      `Pi skill snapshot ${snapshot.dir} exists without the expected completion marker`,
    );
  }
  return true;
}

/** Publish a local snapshot once; existing snapshots are only validated and reused. */
export function materializeLocalPiSkillSnapshot(
  snapshot: PiSkillSnapshot,
): void {
  if (validateLocalPiSkillSnapshot(snapshot)) return;

  const root = dirname(snapshot.dir);
  mkdirSync(root, { recursive: true });
  const staging = mkdtempSync(join(root, `.${snapshot.digest}.tmp-`));
  try {
    for (const skill of snapshot.skills) {
      cpSync(skill.dir, join(staging, skill.name), {
        recursive: true,
        dereference: true,
      });
    }
    writeFileSync(
      join(staging, PI_SKILL_SNAPSHOT_MARKER),
      snapshot.marker,
      "utf-8",
    );
    try {
      renameSync(staging, snapshot.dir);
    } catch (err) {
      if (!validateLocalPiSkillSnapshot(snapshot)) throw err;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function readDaytonaSnapshotMarker(
  sandbox: any,
  snapshot: PiSkillSnapshot,
): Promise<string | undefined> {
  try {
    const bytes = await sandbox.readFsFile({
      path: `${snapshot.dir}/${PI_SKILL_SNAPSHOT_MARKER}`,
    });
    return Buffer.from(bytes).toString("utf-8");
  } catch {
    return undefined;
  }
}

async function validateDaytonaPiSkillSnapshot(
  sandbox: any,
  snapshot: PiSkillSnapshot,
): Promise<boolean> {
  const marker = await readDaytonaSnapshotMarker(sandbox, snapshot);
  if (marker === undefined) return false;
  if (marker !== snapshot.marker) {
    throw new Error(
      `Pi skill snapshot ${snapshot.dir} exists without the expected completion marker`,
    );
  }
  return true;
}

/** Publish a Daytona snapshot through a unique staging dir and a non-overwriting move. */
export async function materializeDaytonaPiSkillSnapshot(
  sandbox: any,
  snapshot: PiSkillSnapshot,
): Promise<void> {
  if (await validateDaytonaPiSkillSnapshot(sandbox, snapshot)) return;

  const root = dirname(snapshot.dir);
  const staging = `${root}/.${snapshot.digest}.tmp-${randomUUID()}`;
  await sandbox.mkdirFs({ path: staging });
  try {
    for (const skill of snapshot.skills) {
      await uploadDirToSandbox(sandbox, skill.dir, `${staging}/${skill.name}`);
    }
    await sandbox.writeFsFile(
      { path: `${staging}/${PI_SKILL_SNAPSHOT_MARKER}` },
      snapshot.marker,
    );
    try {
      await sandbox.moveFs({
        from: staging,
        to: snapshot.dir,
        overwrite: false,
      });
    } catch (err) {
      if (!(await validateDaytonaPiSkillSnapshot(sandbox, snapshot))) throw err;
    }
  } finally {
    if (typeof sandbox.runProcess === "function") {
      await sandbox
        .runProcess({ command: "rm", args: ["-rf", "--", staging] })
        .catch(() => {});
    }
  }
}

// The bundled Agenta Pi extension (tracing + tools). Built by `pnpm run build:extension`
// and baked into the image; installed into Pi's agent dir so Pi loads it on every run.
export const EXTENSION_BUNDLE =
  process.env.SANDBOX_AGENT_EXTENSION_BUNDLE ??
  join(PKG_ROOT, "dist", "extensions", "agenta.js");

/**
 * Env the Agenta Pi extension reads. Tool env contains only public metadata plus the
 * relay directory; private specs/auth stay in the runner.
 *
 * The OTLP bearer is deliberately NOT placed in `OTEL_EXPORTER_OTLP_HEADERS` (or any other
 * plain env var): that env is inherited by the harness process, so a prompt-injected sandbox
 * could read/echo the caller's reusable Authorization bearer and impersonate the caller. It
 * rides a runner-written 0600 read-once file whose PATH is the only thing env carries
 * (`opts.otlpAuthFilePath` -> `AGENTA_AGENT_OTLP_AUTH_FILE`, see `writeOtlpAuthFile`).
 */
export function buildPiExtensionEnv(
  request: AgentRunRequest,
  tracing: boolean,
  opts: {
    relayDir?: string;
    usageOutPath?: string;
    otlpAuthFilePath?: string;
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
  if (otlp?.headers?.authorization && opts.otlpAuthFilePath)
    env.AGENTA_AGENT_OTLP_AUTH_FILE = opts.otlpAuthFilePath;
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
    // Hop-1 response-watch kill switch (event-driven-tool-relay plan, decision 7): the
    // in-sandbox writer defaults it to true, so it is only forwarded — verbatim — when
    // the operator set it on the runner.
    const responseWatch =
      process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
    if (responseWatch !== undefined)
      env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED = responseWatch;
  }
  // Builtin gating needs no relay dir: the gate rides the extension's `ctx.ui.confirm`
  // dialog onto the ACP permission plane (Pi approval parking), not the file relay.
  if (opts.builtinGatingActive) {
    env.AGENTA_AGENT_BUILTIN_GATING = "1";
    env.AGENTA_AGENT_BUILTIN_GRANTS = (opts.builtinGrants ?? []).join(",");
  }
  if (opts.usageOutPath)
    env.AGENTA_AGENT_USAGE_CAPTURE_PATH = opts.usageOutPath;
  return env;
}

/**
 * Write the OTLP bearer to a 0600 file at `path`: the runner still holds this value
 * in memory for its own out-of-band use (session/mount calls), but the harness process only
 * ever gets a path, never the value, via env. Best-effort: a write failure just means the
 * extension traces without export auth (falls back to its own env fallback, if any).
 */
export function writeOtlpAuthFile(
  path: string,
  authorization: string,
  log: Log = () => {},
): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, authorization, { encoding: "utf-8", mode: 0o600 });
  } catch (err) {
    log(`otlp auth file write skipped: ${(err as Error).message}`);
  }
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

/**
 * Seed a throwaway local Pi agent dir from `sourceAgentDir` and install the Agenta extension
 * into it.
 */
export function prepareLocalAgentDir(
  sourceAgentDir: string,
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
    const runAgentDir = prepareLocalAgentDir(plan.sourcePiAgentDir, log);
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
  } else {
    // unset here means this run has no Agenta extension (tracing + tools); warn so it's visible.
    log(
      "PI_CODING_AGENT_DIR is unset; plain local Pi run has no Agenta extension installed",
    );
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
