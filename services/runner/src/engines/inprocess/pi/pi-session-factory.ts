/**
 * Build one Pi SDK session from memory.
 *
 * Nothing the model or the drive can write decides how a session is built: settings are in
 * memory (no project trust, no package installs), extensions, themes and prompt templates are not
 * loaded from disk, the system prompt comes from the run plan, skills come from the run's own
 * snapshot, and the agent dir is an empty folder of this session's own. Model keys and logins
 * come from the credential store and the run's model environment, never from `process.env`.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionUIContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { InMemoryModelsStore, type CredentialStore } from "pi-coding-agent-pi-ai";
import { createAgentaExtension } from "../../../extensions/agenta.ts";
import { apiKeysFromModelEnvironment } from "./credentials.ts";
import { transcriptFileForSession } from "../../sandbox_agent/pi-error.ts";

/** Pi built-ins that must never be active in the runner process (they would run on the host). */
export const EXCLUDED_BUILTIN_TOOLS = ["powershell"];

export interface PiSessionSpec {
  cwd: string;
  /** Where Pi keeps this conversation's transcripts (the durable session folder). */
  sessionDir: string | undefined;
  /** The run's skill snapshot. */
  skillDir: string | undefined;
  /** The models.json the runner wrote for this run, if any. Never a file-tool root. */
  modelsPath: string | undefined;
  /** A custom provider from that models.json and the key the run resolved for it. */
  customProvider?: { providerId: string; key: string };
  /** Model credentials by env var name, for this session only. */
  modelEnv: Record<string, string>;
  credentials: CredentialStore;
  systemPrompt: string | undefined;
  appendSystemPrompt: string | undefined;
  tools: ToolDefinition<any, any>[];
  /** The Agenta extension's settings (tool specs file, relay dir, trace control, gates). */
  extensionEnv: Record<string, string>;
  uiContext: ExtensionUIContext;
  resumeAgentSessionId?: string;
  log: (message: string) => void;
}

export interface OpenedPiSession {
  session: AgentSession;
  runtime: ModelRuntime;
  resumed: boolean;
  /** Remove the session's private agent dir; call after the session is disposed. */
  cleanup(): Promise<void>;
}

/** A Pi transcript by session id: by file name first, then by the header line. */
async function findSessionFile(sessionDir: string | undefined, agentSessionId: string): Promise<string | undefined> {
  if (!sessionDir) return undefined;
  const names = (await readdir(sessionDir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl"));
  const byName = transcriptFileForSession(names, agentSessionId);
  if (byName) return join(sessionDir, byName);
  for (const name of names) {
    try {
      const head = (await readFile(join(sessionDir, name), "utf-8")).split("\n", 1)[0];
      if (head && JSON.parse(head).id === agentSessionId) return join(sessionDir, name);
    } catch {}
  }
  return undefined;
}

export async function openPiSession(spec: PiSessionSpec): Promise<OpenedPiSession> {
  const agentDir = await mkdtemp(join(tmpdir(), "agenta-pi-session-"));
  const cleanup = () => rm(agentDir, { recursive: true, force: true });
  try {
    const runtime = await ModelRuntime.create({
      credentials: spec.credentials,
      modelsPath: spec.modelsPath ?? null,
      modelsStore: new InMemoryModelsStore(),
      allowModelNetwork: false,
    });
    const providerIds = runtime.getProviders().map((p) => p.id);
    for (const [providerId, key] of apiKeysFromModelEnvironment(spec.modelEnv, providerIds)) {
      await runtime.setRuntimeApiKey(providerId, key);
    }
    if (spec.customProvider) await runtime.setRuntimeApiKey(spec.customProvider.providerId, spec.customProvider.key);

    const settingsManager = SettingsManager.inMemory({});
    const loader = new DefaultResourceLoader({
      cwd: spec.cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      extensionFactories: [{ name: "agenta", factory: createAgentaExtension(spec.extensionEnv) }],
      noThemes: true,
      noPromptTemplates: true,
      noSkills: true,
      ...(spec.skillDir ? { additionalSkillPaths: [spec.skillDir] } : {}),
      // Explicit values stop Pi from discovering `.pi/SYSTEM.md` in the drive.
      systemPrompt: spec.systemPrompt ?? "",
      appendSystemPrompt: spec.appendSystemPrompt ? [spec.appendSystemPrompt] : [],
    });
    await loader.reload();

    const existing = spec.resumeAgentSessionId ? await findSessionFile(spec.sessionDir, spec.resumeAgentSessionId) : undefined;
    const sessionManager = existing
      ? SessionManager.open(existing, spec.sessionDir, spec.cwd)
      : SessionManager.create(spec.cwd, spec.sessionDir);
    const { session } = await createAgentSession({
      cwd: spec.cwd,
      agentDir,
      modelRuntime: runtime,
      customTools: spec.tools,
      excludeTools: EXCLUDED_BUILTIN_TOOLS,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
    });
    await session.bindExtensions({
      uiContext: spec.uiContext,
      mode: "rpc",
      onError: (err) => spec.log(`[inprocess] extension error: ${String(err.error).slice(0, 200)}`),
    });
    return { session, runtime, resumed: !!existing, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
