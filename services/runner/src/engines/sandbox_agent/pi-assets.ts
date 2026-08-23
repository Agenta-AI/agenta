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
import {
  encodePiModelProviderOverride,
  PI_MODEL_PROVIDER_OVERRIDE_ENV,
} from "../../extensions/model-provider-override.ts";
import {
  advertisedToolSpecs,
  type AdvertisedToolSpec,
} from "../../tools/public-spec.ts";
import { PUBLIC_SPECS_FILE_ENV } from "../../tools/tool-mcp-env.ts";
import type { MaterializedSkill } from "../skills.ts";
import { PKG_ROOT } from "./daemon.ts";
import {
  describePiModelsJsonPlan,
  isPiModelConfigApplicable,
  isPiModelRegistrationPlan,
  PI_MODELS_JSON_FILENAME,
  serializePiModelsJson,
  type PiModelsJsonPlan,
} from "./pi-model-config.ts";
import type {
  RunPlan,
  RunPlanCredentials,
  RunPlanPrompt,
  RunPlanWorkspace,
} from "./run-plan.ts";

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
  plan: Pick<RunPlan, "isPi"> & {
    workspace: Pick<RunPlanWorkspace, "cwd">;
  },
  env: Record<string, string>,
): string | undefined {
  if (!plan.isPi) return undefined;
  const sessionDir = piSessionWorkspaceDir(plan.workspace.cwd);
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
  plan: Pick<RunPlan, "isPi"> & {
    workspace: Pick<RunPlanWorkspace, "cwd" | "skillDirs">;
  },
): PiSkillSnapshot | undefined {
  if (!plan.isPi || plan.workspace.skillDirs.length === 0) return undefined;

  const skills = [...plan.workspace.skillDirs].sort((a, b) =>
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
    dir: join(plan.workspace.cwd, "agents", "skills", digest),
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

// The bundled Agenta Pi extension (tracing + tools + permission gating). Built by
// `pnpm run build:extension` and baked into the image; installed into Pi's agent dir so Pi loads
// it on every run. Resolved lazily (a function, not a module-level const) so
// `SANDBOX_AGENT_EXTENSION_BUNDLE` is honored at call time — tests point it at a fixture, and it
// mirrors `toolMcpBundlePath()` in tool-mcp-assets.ts. The override selects code, so it is trusted
// deployment configuration, never run or request configuration.
export function extensionBundlePath(): string {
  return (
    process.env.SANDBOX_AGENT_EXTENSION_BUNDLE ??
    join(PKG_ROOT, "dist", "extensions", "agenta.js")
  );
}

/**
 * Thrown when the policy could gate a Pi built-in tool (`builtinGatingActive`) but the Agenta
 * permission extension could not be installed, so Pi would run its built-in tools with NO policy
 * enforcement. Fail closed: stop the run rather than run unprotected. Mirrors
 * `TOOL_MCP_UNAVAILABLE_MESSAGE` in tool-mcp-assets.ts — a named message the engine's own catch
 * turns into `{ ok: false, error }` and a visible error frame. Single line so `conciseError`
 * (which keeps only the first line) surfaces it verbatim.
 */
export const PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE =
  "The agent could not enforce its permission policy: the permission component failed to install, " +
  "so no built-in tool could be gated. The run was stopped so no tool ran outside your policy. " +
  "Ask your deployment operator to make the runner's Pi agent directory writable, or rebuild and " +
  "republish the runner image.";

/**
 * Thrown (via the engine's named-message pattern) when a run has a `models.json` plan but the file
 * could not be materialized. Fail closed: the selected model would not be registered, so the run
 * must stop rather than fall back to a default provider (design Decision 6). Single line so
 * `conciseError` surfaces it verbatim.
 */
export const PI_MODEL_CONFIG_WRITE_FAILED_MESSAGE =
  "The agent could not write its model configuration (models.json), so the selected model could " +
  "not be registered. The run was stopped rather than fall back to a " +
  "default provider. Ask your deployment operator to make the runner's Pi agent directory writable.";

/**
 * Thrown (via the engine's named-message pattern) when the run routes its model provider through
 * the extension's endpoint override (`model-provider-override.ts`) but the Agenta extension could
 * not be installed. Fail closed: without the extension the harness would silently call the
 * provider's DEFAULT endpoint with credentials resolved for the custom one. Single line so
 * `conciseError` surfaces it verbatim.
 */
export const PI_MODEL_OVERRIDE_EXTENSION_UNAVAILABLE_MESSAGE =
  "The agent could not apply its custom model endpoint: the Agenta extension failed to install, " +
  "so the provider override could not be registered. The run was stopped rather than call the " +
  "default endpoint. Ask your deployment operator to rebuild and republish the runner image.";

/**
 * Thrown (via the engine's named-message pattern) when a local subscription run's Pi agent dir —
 * the operator's mounted login — is not writable by the runner user. Pi persists its session
 * rollouts and OAuth refresh into that dir, so an unwritable mount makes the harness die at
 * startup with no output at all: the turn ends instantly and the UI shows nothing (the exact
 * "session looks stuck, user retries forever" failure). Fail closed with a visible error instead.
 * Single line so `conciseError` surfaces it verbatim.
 */
export const PI_AGENT_DIR_UNWRITABLE_MESSAGE =
  "The agent could not use the mounted Pi login directory: it is not writable by the runner's " +
  "user, so the harness cannot persist its session or refresh its login. The run was stopped. " +
  "Ask your deployment operator to make the mounted Pi agent directory writable by the runner's uid.";

/**
 * Write the Pi `models.json` into a local (throwaway) agent dir with mode `0600` via an atomic
 * temp-file-plus-rename. THROWS on failure so the caller can make materialization terminal — a
 * managed custom run must never fall through to a default provider (design Decision 6). The file
 * carries only the `$OPENAI_API_KEY` reference, never the key value.
 */
export function writePiModelsConfigLocal(
  agentDir: string,
  plan: PiModelsJsonPlan,
): void {
  const document = serializePiModelsJson(plan);
  const target = join(agentDir, PI_MODELS_JSON_FILENAME);
  const staging = join(
    agentDir,
    `.${PI_MODELS_JSON_FILENAME}.${randomUUID()}.tmp`,
  );
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(staging, document, { encoding: "utf-8", mode: 0o600 });
  try {
    renameSync(staging, target);
  } catch (err) {
    rmSync(staging, { force: true });
    throw err;
  }
}

/**
 * Thrown (via the engine's named-message pattern) when the run's tool specs could not be
 * delivered to the harness. Fail loud rather than start a run whose tools the model never sees —
 * the silent-tool-drop failure (F-042) is indistinguishable from a model that chose not to call
 * them. Mirrors `TOOL_MCP_UNAVAILABLE_MESSAGE` for the non-Pi shim. Single line so
 * `conciseError` surfaces it verbatim.
 */
export const PI_TOOL_SPECS_UNAVAILABLE_MESSAGE =
  "The agent could not deliver its tool definitions to the harness, so none of its tools would " +
  "have been available to the model. The run was stopped rather than run without them. Ask your " +
  "deployment operator to check that the runner can write its relay directory.";

/**
 * The file the run's advertised tool specs ride to the Pi extension.
 *
 * A FILE, NEVER AN ENV VALUE. Linux caps a single argv/env string at `MAX_ARG_STRLEN`
 * (131,072 bytes) and fails the whole `execve` with `E2BIG` when one exceeds it. Tool JSON
 * Schemas are unbounded, so no size threshold is safe: a session with 44 hydrated Composio
 * tools serialized to ~250 KB and every run died with "spawn E2BIG" before the harness
 * started. The non-Pi stdio shim already rides a file for the same reason — see
 * `PUBLIC_SPECS_FILE_ENV` in `tools/tool-mcp-env.ts`, whose name this reuses.
 *
 * A SIBLING of the relay dir, like the OTLP auth file, because `prepareWorkspace` clears and
 * recreates the relay dir itself on every turn. It is keyed on the conversation (the relay dir
 * is), non-secret, and rewritten in place per run, so it is left behind at teardown exactly as
 * the relay dir is.
 */
export function piToolSpecsFilePath(relayDir: string): string {
  return `${relayDir}.tool-specs.json`;
}

/** The run's advertised specs plus the path the extension reads them from. */
export interface PiToolSpecsDelivery {
  /** A runner host path on local; the deterministic in-sandbox path on Daytona. */
  path: string;
  /** The serialized `AdvertisedToolSpec` array — the exact bytes written to `path`. */
  contents: string;
  specs: AdvertisedToolSpec[];
}

/**
 * The tool specs this Pi run advertises, or `undefined` when there is nothing to advertise (no
 * tools, or no relay dir to relay their execution back through). Takes the resolved specs so
 * both sides derive from one source: the env builder from `request.customTools`, the Daytona
 * upload from `plan.tools.toolSpecs` (the same array).
 */
export function resolvePiToolSpecsDelivery(
  toolSpecs: ResolvedToolSpec[],
  relayDir: string | undefined,
): PiToolSpecsDelivery | undefined {
  const specs = advertisedToolSpecs(toolSpecs);
  if (specs.length === 0 || !relayDir) return undefined;
  return {
    path: piToolSpecsFilePath(relayDir),
    contents: JSON.stringify(specs),
    specs,
  };
}

/**
 * Write the specs file for a LOCAL Pi run. THROWS the named message on failure: without the file
 * the extension registers no tools, and a run whose tools silently vanished is worse than one
 * that stops with a reason.
 */
export function writePiToolSpecsFileLocal(
  delivery: PiToolSpecsDelivery,
  log: Log = () => {},
): void {
  try {
    mkdirSync(dirname(delivery.path), { recursive: true });
    writeFileSync(delivery.path, delivery.contents, "utf-8");
  } catch (err) {
    log(`pi tool specs write failed: ${(err as Error).message}`);
    throw new Error(PI_TOOL_SPECS_UNAVAILABLE_MESSAGE);
  }
  log(
    `pi tool specs written path=${delivery.path} tools=${delivery.specs.length} ` +
      `bytes=${Buffer.byteLength(delivery.contents, "utf-8")}`,
  );
}

/**
 * Upload the specs file into a Daytona sandbox: the runner's filesystem is not the sandbox's, and
 * the sandbox env map is fixed at creation, so the env var names a deterministic in-sandbox path
 * that this fills in before the session starts. THROWS the named message on failure, for the same
 * reason the local write does.
 */
export async function uploadPiToolSpecsToSandbox(
  sandbox: any,
  delivery: PiToolSpecsDelivery,
  log: Log = () => {},
): Promise<void> {
  try {
    await sandbox.mkdirFs({ path: dirname(delivery.path) });
    await sandbox.writeFsFile({ path: delivery.path }, delivery.contents);
  } catch (err) {
    log(`pi tool specs upload failed: ${(err as Error).message}`);
    throw new Error(PI_TOOL_SPECS_UNAVAILABLE_MESSAGE);
  }
  log(
    `pi tool specs uploaded path=${delivery.path} tools=${delivery.specs.length} ` +
      `bytes=${Buffer.byteLength(delivery.contents, "utf-8")}`,
  );
}

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

  // Point Pi's built-in provider at the resolved custom base URL via the Agenta extension
  // (`model-provider-override.ts`). Skipped when the managed OpenAI-compatible custom path
  // already routes this run through its own `models.json` provider (`pi-model-config.ts`) —
  // two competing registrations for the same run would race for the provider.
  const modelBaseUrl = request.modelConnection?.endpoint?.baseUrl;
  if (modelBaseUrl !== undefined && !isPiModelConfigApplicable(request)) {
    env[PI_MODEL_PROVIDER_OVERRIDE_ENV] = encodePiModelProviderOverride({
      provider: request.modelConnection?.provider,
      baseUrl: modelBaseUrl,
    });
  }

  // The specs themselves ride a file whose PATH is all env carries: one env string holding every
  // hydrated tool spec overflows Linux's per-string execve limit and kills the spawn with E2BIG.
  // See `piToolSpecsFilePath`. The runner writes that file locally, or uploads it on Daytona.
  const toolSpecs = resolvePiToolSpecsDelivery(
    (request.customTools as ResolvedToolSpec[]) ?? [],
    opts.relayDir,
  );
  if (toolSpecs && opts.relayDir) {
    env[PUBLIC_SPECS_FILE_ENV] = toolSpecs.path;
    env.AGENTA_AGENT_TOOLS_RELAY_DIR = opts.relayDir;
    // Hop-1 response-watch kill switch (event-driven-tool-relay plan, decision 7): the
    // in-sandbox writer defaults it to true, so it is only forwarded — verbatim — when
    // the operator set it on the runner.
    const responseWatch =
      process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
    if (responseWatch !== undefined)
      env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED = responseWatch;
  }
  // Only reached for a Pi run (environment-setup gates on `plan.isPi`), and every Pi run
  // activates all seven builtins.
  env.AGENTA_AGENT_BUILTIN_ACTIVATION = "1";
  // Builtin gating needs no relay dir: the gate rides the extension's `ctx.ui.confirm`
  // dialog onto the ACP permission plane (Pi approval parking), not the file relay.
  if (opts.builtinGatingActive) env.AGENTA_AGENT_BUILTIN_GATING = "1";
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

/**
 * Install the extension bundle into a local Pi agent dir's extensions/. Reports whether the
 * install succeeded so the caller can fail closed when the policy needs it (a missing bundle or
 * an unwritable dir returns false rather than silently proceeding with no enforcement).
 */
export function installPiExtensionLocal(
  agentDir: string,
  log: Log = () => {},
): boolean {
  const bundle = extensionBundlePath();
  if (!existsSync(bundle)) {
    log(`pi extension bundle missing at ${bundle} (run build:extension)`);
    return false;
  }
  try {
    const dir = join(agentDir, "extensions");
    mkdirSync(dir, { recursive: true });
    copyFileSync(bundle, join(dir, "agenta.js"));
    return true;
  } catch (err) {
    log(`pi extension install skipped: ${(err as Error).message}`);
    return false;
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

/**
 * Upload the extension bundle into a Daytona sandbox's Pi extensions dir. Reports whether the
 * upload succeeded so the caller can fail closed when the policy needs enforcement (a missing
 * bundle or a failed upload returns false rather than silently proceeding with no enforcement).
 */
export async function uploadPiExtensionToSandbox(
  sandbox: any,
  agentDir: string,
  log: Log = () => {},
): Promise<boolean> {
  const bundle = extensionBundlePath();
  if (!existsSync(bundle)) {
    log(`pi extension bundle missing at ${bundle} (run build:extension)`);
    return false;
  }
  try {
    const dir = `${agentDir}/extensions`;
    await sandbox.mkdirFs({ path: dir });
    await sandbox.writeFsFile(
      { path: `${dir}/agenta.js` },
      readFileSync(bundle, "utf-8"),
    );
    return true;
  } catch (err) {
    log(`pi extension upload skipped: ${(err as Error).message}`);
    return false;
  }
}

export interface PreparedLocalAgentDir {
  /** The throwaway per-run agent dir the runtime user owns (under the system temp path). */
  dir: string;
  /** False when the Agenta permission extension could not be installed into it. */
  extensionInstalled: boolean;
}

/**
 * Seed a throwaway local Pi agent dir from `sourceAgentDir` and install the Agenta extension
 * into it. The temp dir lives under the system temp path, which the runtime user owns, so the
 * install never depends on the operator-configured `PI_CODING_AGENT_DIR` being writable. Reports
 * whether the extension install succeeded.
 *
 * `seedCredentials` (default true) controls whether the operator's `auth.json` is copied in. A
 * managed OpenAI-compatible custom run sets it FALSE: that run authenticates purely from the
 * vault-resolved `$OPENAI_API_KEY` plus its `models.json`, so the operator's personal Pi login
 * must not leak into it (a copied `auth.json` could let Pi fall back to the operator's own
 * provider). The non-credential `settings.json` is always carried.
 */
export function prepareLocalAgentDir(
  sourceAgentDir: string,
  log: Log = () => {},
  opts: { seedCredentials?: boolean } = {},
): PreparedLocalAgentDir {
  const seedCredentials = opts.seedCredentials ?? true;
  const dir = mkdtempSync(join(tmpdir(), "agenta-pi-agentdir-"));
  const seedFiles = seedCredentials
    ? ["auth.json", "settings.json"]
    : ["settings.json"];
  for (const name of seedFiles) {
    const src = join(sourceAgentDir, name);
    try {
      if (existsSync(src)) copyFileSync(src, join(dir, name));
    } catch (err) {
      log(`agent-dir seed skipped for ${name}: ${(err as Error).message}`);
    }
  }
  const extensionInstalled = installPiExtensionLocal(dir, log);
  return { dir, extensionInstalled };
}

export interface PrepareLocalPiAssetsInput {
  plan: Pick<RunPlan, "isPi" | "isDaytona"> & {
    credentials: Pick<RunPlanCredentials, "credentialMode">;
    workspace: Pick<RunPlanWorkspace, "skillDirs" | "sourcePiAgentDir">;
    prompt: Pick<
      RunPlanPrompt,
      "hasSystemPrompt" | "systemPrompt" | "appendSystemPrompt"
    >;
  };
  env: Record<string, string>;
  /**
   * The run's Pi `models.json` plan, when it has one. The isolated per-run agent dir receives the
   * file.
   *
   * A CUSTOM-PROVIDER plan additionally suppresses seeding the operator's personal `auth.json`:
   * that run authenticates purely from the vault key referenced by `$OPENAI_API_KEY`, and a copied
   * login could let Pi fall back to the operator's own provider. A REGISTRATION plan is the
   * opposite case — it merges a model into a provider Pi already has, which authenticates exactly
   * like that provider's catalog models do, so credential seeding is left untouched.
   */
  piModelConfig?: PiModelsJsonPlan;
  log?: Log;
}

export interface PrepareLocalPiAssetsResult {
  /**
   * The THROWAWAY per-run dir when one was created — `undefined` means "nothing here for the caller
   * to delete" (the caller `rmSync`s `dir` at teardown, so the operator's own login must never be
   * returned).
   */
  dir: string | undefined;
  /**
   * False when the Agenta permission extension could not be installed for this run. The caller
   * fails the run closed when the policy could gate a Pi built-in tool (`builtinGatingActive`).
   */
  extensionInstalled: boolean;
  /**
   * False only when a model-config plan was present but its `models.json` could not be written;
   * true when there was nothing to write or the write succeeded. The caller fails the run closed
   * when this is false (materialization is terminal — design Decision 6).
   */
  modelConfigWritten: boolean;
  /**
   * False only for a subscription run whose operator-mounted agent dir failed the write probe. Pi
   * persists session rollouts and its OAuth refresh into that dir, so an unwritable mount makes
   * the harness die at startup with zero output; the caller fails the run closed with
   * `PI_AGENT_DIR_UNWRITABLE_MESSAGE` instead. Always true for the per-run-dir paths (the dir is
   * created by the runtime user) and for non-local-Pi runs.
   */
  agentDirWritable: boolean;
}

/**
 * Probe whether the runner user can write to both Pi state targets: the agent-dir root for login
 * refreshes and extension assets, plus `sessions/` for transcript rollouts. A partially writable
 * mount is still unusable, and Pi fails on EACCES with an instant silent exit.
 */
export function probePiAgentDirWritable(
  agentDir: string,
  log: Log = () => {},
): boolean {
  const sessionsDir = join(agentDir, "sessions");
  const probes = [
    join(agentDir, `.agenta-write-probe-${randomUUID()}`),
    join(sessionsDir, `.agenta-write-probe-${randomUUID()}`),
  ];
  try {
    mkdirSync(sessionsDir, { recursive: true });
    for (const probe of probes) {
      writeFileSync(probe, "", "utf-8");
      rmSync(probe, { force: true });
    }
    return true;
  } catch (err) {
    for (const probe of probes) {
      try {
        rmSync(probe, { force: true });
      } catch {
        // the probe file was never created; nothing to clean up
      }
    }
    log(`pi agent dir write probe failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Prepare local Pi's agent dir assets and report the throwaway dir plus whether the permission
 * extension installed.
 *
 * Two shapes:
 *
 * - Subscription (`runtime_provided`): the harness runs directly out of the operator's read-write
 *   mounted login, exactly like a normal local Pi install. Pi refreshes its OAuth token mid-run and
 *   writes the new one back into its agent dir; a per-run copy would throw that refresh away, so
 *   once the provider rotated the refresh token the next run would fail and the operator would have
 *   to log in by hand. Returns `dir: undefined` so teardown cannot delete the mount. The extension
 *   still installs into the mount; a non-writable mount reports `extensionInstalled: false`.
 * - Managed / none: no credential to preserve, so every run (plain, or with skills / a system
 *   prompt) gets an isolated per-run copy under the system temp path the runtime user owns, and the
 *   extension installs there. This removes the fail-open that shipped when the configured
 *   `PI_CODING_AGENT_DIR` (e.g. `/pi-agent` on the published image) was not writable by the runtime
 *   user: the install no longer depends on that directory being writable.
 *
 * Tradeoff (interface.md section 6): concurrent local subscription runs share the one agent dir,
 * the same way two local `pi` sessions do. This path is single-trusted-operator only.
 */
export function prepareLocalPiAssets({
  plan,
  env,
  piModelConfig,
  log = () => {},
}: PrepareLocalPiAssetsInput): PrepareLocalPiAssetsResult {
  // Not a local Pi run: nothing to install here, so enforcement is not this path's concern.
  if (!plan.isPi || plan.isDaytona)
    return {
      dir: undefined,
      extensionInstalled: true,
      modelConfigWritten: true,
      agentDirWritable: true,
    };

  // buildRunPlan already rejected a local runtime_provided run with no configured
  // PI_CODING_AGENT_DIR, so `sourcePiAgentDir` here IS the operator's mount.
  if (plan.credentials.credentialMode === "runtime_provided") {
    const agentDir = plan.workspace.sourcePiAgentDir;
    // A custom-provider plan cannot reach here (it requires credentialMode "env"). A model
    // REGISTRATION plan can, and it is deliberately dropped: this dir is the operator's own Pi
    // login, shared by every subscription run and rewritten by Pi's own OAuth refresh, so a
    // per-run models.json would outlive the run that wanted it and change which models every
    // later session sees. Pi reads models.json only from its agent dir — there is no
    // session-scoped model config to write instead — so a subscription run keeps Pi's built-in
    // registry, and a hand-entered model id fails loudly at model selection as it does today.
    if (piModelConfig) {
      log(
        `pi models.json skipped on the operator's mounted agent dir (subscription run): ` +
          describePiModelsJsonPlan(piModelConfig),
      );
    }
    const agentDirWritable = probePiAgentDirWritable(agentDir, log);
    const extensionInstalled = installPiExtensionLocal(agentDir, log);
    if (plan.prompt.hasSystemPrompt) {
      writeSystemPromptLocal(
        agentDir,
        plan.prompt.systemPrompt,
        plan.prompt.appendSystemPrompt,
        log,
      );
    }
    env.PI_CODING_AGENT_DIR = agentDir;
    // Deliberately NOT returned as a throwaway: this is the operator's login, not a temp dir.
    return {
      dir: undefined,
      extensionInstalled,
      modelConfigWritten: true,
      agentDirWritable,
    };
  }

  // Managed / none: always route through a throwaway per-run dir the runtime user owns, so the
  // extension install never depends on the configured PI_CODING_AGENT_DIR being writable, and any
  // models.json is scoped to this run alone. A managed OpenAI-compatible custom run (a
  // custom-provider plan) additionally does NOT receive the operator's personal auth.json.
  const { dir: runAgentDir, extensionInstalled } = prepareLocalAgentDir(
    plan.workspace.sourcePiAgentDir,
    log,
    {
      seedCredentials: !(
        piModelConfig && !isPiModelRegistrationPlan(piModelConfig)
      ),
    },
  );
  if (plan.prompt.hasSystemPrompt) {
    writeSystemPromptLocal(
      runAgentDir,
      plan.prompt.systemPrompt,
      plan.prompt.appendSystemPrompt,
      log,
    );
  }
  let modelConfigWritten = true;
  if (piModelConfig) {
    try {
      writePiModelsConfigLocal(runAgentDir, piModelConfig);
      log(`pi models.json written ${describePiModelsJsonPlan(piModelConfig)}`);
    } catch (err) {
      // Terminal: the caller stops the run rather than fall back to a default provider.
      modelConfigWritten = false;
      log(`pi models.json write failed: ${(err as Error).message}`);
    }
  }
  env.PI_CODING_AGENT_DIR = runAgentDir;
  return {
    dir: runAgentDir,
    extensionInstalled,
    modelConfigWritten,
    agentDirWritable: true,
  };
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
