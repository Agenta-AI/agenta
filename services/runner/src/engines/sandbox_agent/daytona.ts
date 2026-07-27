import { join } from "node:path";

import { createAcpFetch } from "./acp-fetch.ts";
import {
  uploadPiExtensionToSandbox,
  uploadSkillsToSandbox,
  uploadSystemPromptToSandbox,
} from "./pi-assets.ts";
import {
  PI_MODELS_JSON_FILENAME,
  serializePiModelsJson,
  type PiModelConfigPlan,
} from "./pi-model-config.ts";
import { type RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

/** In-sandbox Pi agent dir on common Daytona images (daemon runs as user `sandbox`). */
export const DAYTONA_PI_DIR =
  process.env.AGENTA_AGENT_SANDBOX_PI_DIR ?? "/home/sandbox/.pi/agent";

// Harness availability is a runtime contract, not operator truth (interface.md section 7): the
// runner pins the Pi version, probes the expected executable in the sandbox, and installs the
// pinned version when a custom image or snapshot lacks it. There is no "installed" env flag.
export const DAYTONA_PI_INSTALL_DIR = "/home/sandbox/.agenta-pi";
export const PINNED_PI_VERSION = "0.80.6";
/** The expected Pi executable path the runner probes and points `PI_ACP_PI_COMMAND` at. */
export const DAYTONA_PI_COMMAND = `${DAYTONA_PI_INSTALL_DIR}/node_modules/.bin/pi`;

/**
 * In-sandbox env for the Daytona daemon: where Pi reads its login, any provider keys,
 * and the Agenta extension env (traceparent + OTLP + tool spec) so the remote Pi traces
 * and runs tools exactly like local. No local-only paths (PATH) here.
 */
export function daytonaEnvVars(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  return {
    PI_CODING_AGENT_DIR: DAYTONA_PI_DIR,
    // Point pi-acp at the pinned `pi` the runner probes/installs at a stable path. The published
    // snapshot bakes Pi there; a custom image gets the pinned install before the session.
    PI_ACP_PI_COMMAND: DAYTONA_PI_COMMAND,
    ...piExtEnv,
    // Provider API keys from the vault: the in-sandbox harness authenticates with these.
    ...secrets,
  };
}

/** True when the pinned Pi executable is already present at the expected path in the sandbox. */
async function probePiInstalled(sandbox: any): Promise<boolean> {
  try {
    const res = await sandbox.runProcess({
      command: "test",
      args: ["-x", DAYTONA_PI_COMMAND],
      timeoutMs: 15_000,
    });
    return res?.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Link a snapshot-baked `pi` (on PATH, e.g. the recipe's global npm install) to the pinned
 * path so a baked snapshot never pays a session-time reinstall. Returns false when no `pi`
 * is on PATH.
 */
async function linkGlobalPi(sandbox: any): Promise<boolean> {
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: [
        "-lc",
        `command -v pi >/dev/null 2>&1 && ` +
          `mkdir -p ${DAYTONA_PI_INSTALL_DIR}/node_modules/.bin && ` +
          `ln -sf "$(command -v pi)" ${DAYTONA_PI_COMMAND}`,
      ],
      timeoutMs: 15_000,
    });
    return res?.exitCode === 0;
  } catch {
    return false;
  }
}

/** Install the pinned `pi` CLI into a Daytona sandbox (a custom image may lack it). */
async function installPiInSandbox(
  sandbox: any,
  log: Log = () => {},
): Promise<void> {
  await sandbox.mkdirFs({ path: DAYTONA_PI_INSTALL_DIR });
  const res = await sandbox.runProcess({
    command: "npm",
    args: [
      "install",
      "--no-fund",
      "--no-audit",
      `@earendil-works/pi-coding-agent@${PINNED_PI_VERSION}`,
    ],
    cwd: DAYTONA_PI_INSTALL_DIR,
    timeoutMs: 180_000,
  });
  if (res?.exitCode !== 0) {
    log(
      `pi install in sandbox exit=${res?.exitCode}: ${String(res?.stderr).slice(-400)}`,
    );
  }
}

/**
 * Probe for the pinned Pi executable and repair when a custom image or snapshot lacks it
 * (interface.md section 7). Repair ladder, cheapest first:
 *  1. the pinned path already exists (baked or repaired earlier) — done;
 *  2. a `pi` is on PATH (the snapshot recipe installs it globally) — link it to the pinned path;
 *  3. install the pinned version.
 * If Pi is still missing after that, the run fails with the missing executable and the attempted
 * version — harness availability is an image/runtime contract, never a silent skip.
 */
export async function ensurePiInSandbox(
  sandbox: any,
  log: Log = () => {},
): Promise<void> {
  if (await probePiInstalled(sandbox)) return;
  if ((await linkGlobalPi(sandbox)) && (await probePiInstalled(sandbox))) {
    log(`[pi-repair] linked snapshot-baked pi to ${DAYTONA_PI_COMMAND}`);
    return;
  }
  log(
    `[pi-repair] pinned pi ${PINNED_PI_VERSION} missing at ${DAYTONA_PI_COMMAND}; installing`,
  );
  try {
    await installPiInSandbox(sandbox, log);
  } catch (err) {
    throw new Error(
      `Failed to install pinned pi ${PINNED_PI_VERSION} at ${DAYTONA_PI_COMMAND}: ` +
        `${(err as Error).message}`,
    );
  }
  if (!(await probePiInstalled(sandbox))) {
    throw new Error(
      `pi ${PINNED_PI_VERSION} is not available at ${DAYTONA_PI_COMMAND} after install.`,
    );
  }
}

/**
 * Upload the exact Pi `models.json` into a Daytona sandbox's Pi agent dir, overwriting any stale
 * file left by an earlier configuration on a reused sandbox. THROWS on failure so the caller makes
 * materialization terminal — a managed custom run must never fall through to a default provider
 * (design Decision 6). The document carries only the `$OPENAI_API_KEY` reference; the key value
 * itself rides `daytonaEnvVars` into the sandbox env.
 */
export async function uploadPiModelsConfigToSandbox(
  sandbox: any,
  agentDir: string,
  plan: PiModelConfigPlan,
  log: Log = () => {},
): Promise<void> {
  await sandbox.mkdirFs({ path: agentDir });
  await sandbox.writeFsFile(
    { path: `${agentDir}/${PI_MODELS_JSON_FILENAME}` },
    serializePiModelsJson(plan),
  );
  log(
    `pi models.json uploaded provider=${plan.providerId} api=${plan.api} ` +
      `model=${plan.models.map((m) => m.id).join(",")}`,
  );
}

/**
 * Remove any stale Pi `models.json` from a reused sandbox when the current run has NO model-config
 * plan, so a reused/parked sandbox never retains a custom provider from an earlier configuration.
 * Best-effort: an absent file (or a provider without a delete op) is fine.
 */
export async function removePiModelsConfigFromSandbox(
  sandbox: any,
  agentDir: string,
  log: Log = () => {},
): Promise<void> {
  try {
    await sandbox.deleteFsEntry?.({
      path: `${agentDir}/${PI_MODELS_JSON_FILENAME}`,
    });
  } catch (err) {
    log(`pi models.json cleanup skipped: ${(err as Error).message}`);
  }
}

export interface PrepareDaytonaPiAssetsInput {
  sandbox: any;
  plan: Pick<
    RunPlan,
    | "isPi"
    | "skillDirs"
    | "hasSystemPrompt"
    | "systemPrompt"
    | "appendSystemPrompt"
  >;
  /**
   * A managed OpenAI-compatible custom run's Pi provider config. When set, its `models.json` is
   * uploaded before the ACP session starts; when absent, any stale `models.json` on a reused
   * sandbox is removed so no earlier provider survives.
   */
  piModelConfig?: PiModelConfigPlan;
  log?: Log;
}

/**
 * Push the Pi login fallback, Agenta extension, forced skills, system prompts, and optional
 * Pi CLI install into a Daytona sandbox. Reports whether the permission extension installed so the
 * caller can fail the run closed when the policy could gate a Pi built-in tool. A non-Pi run needs
 * no extension, so it reports `true` (nothing to enforce here).
 */
export async function prepareDaytonaPiAssets({
  sandbox,
  plan,
  piModelConfig,
  log = () => {},
}: PrepareDaytonaPiAssetsInput): Promise<boolean> {
  if (!plan.isPi) return true;

  // A Daytona run never receives the runner's own Pi login: subscription (runtime_provided) auth
  // is rejected for Daytona in buildRunPlan, and a managed run authenticates from the vault keys
  // in `daytonaEnvVars`. The runner therefore uploads only the inert Agenta extension, forced
  // skills, and system prompts — never a personal `auth.json` (interface.md section 6).
  const extensionInstalled = await uploadPiExtensionToSandbox(
    sandbox,
    DAYTONA_PI_DIR,
    log,
  );
  // Managed OpenAI-compatible custom provider: upload the exact models.json (overwriting stale)
  // before the session starts. No plan: remove any stale file so a reused sandbox keeps no earlier
  // provider. Upload failure THROWS here and is terminal in the engine's acquire try.
  if (piModelConfig) {
    await uploadPiModelsConfigToSandbox(
      sandbox,
      DAYTONA_PI_DIR,
      piModelConfig,
      log,
    );
  } else {
    await removePiModelsConfigFromSandbox(sandbox, DAYTONA_PI_DIR, log);
  }
  if (plan.skillDirs.length > 0) {
    await uploadSkillsToSandbox(sandbox, DAYTONA_PI_DIR, plan.skillDirs, log);
  }
  if (plan.hasSystemPrompt) {
    await uploadSystemPromptToSandbox(
      sandbox,
      DAYTONA_PI_DIR,
      plan.systemPrompt,
      plan.appendSystemPrompt,
      log,
    );
  }
  const piInstallStartedAt = Date.now();
  await ensurePiInSandbox(sandbox, log);
  log(
    `[timing] stage=pi_install ms=${Math.round(Date.now() - piInstallStartedAt)} sandbox=${sandbox?.sandboxId ?? "-"} session=-`,
  );
  return extensionInstalled;
}

/**
 * A `fetch` that persists cookies per host. Daytona's preview proxy authenticates with a
 * `daytona-sandbox-auth-*` cookie set on the first response; Node's fetch keeps no cookie
 * jar, so without this the proxy rejects later ACP requests with "Authentication
 * required" / 502. The sandbox-agent SDK accepts a custom fetch, so we hand it this one.
 *
 * It layers on {@link createAcpFetch} (the long-timeout ACP dispatcher) so a paused HITL turn
 * over Daytona is not reaped by undici's default `headersTimeout` either.
 */
export function createCookieFetch(
  inner: typeof fetch = createAcpFetch(),
): typeof fetch {
  const jar = new Map<string, Map<string, string>>(); // host -> (name -> "name=value")
  return async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const host = url.host;
    const cookies = jar.get(host);
    const headers = new Headers(
      init?.headers ?? (typeof input !== "string" ? input.headers : undefined),
    );
    if (cookies && cookies.size > 0) {
      const existing = headers.get("cookie");
      const merged = [...cookies.values()];
      if (existing) merged.unshift(existing);
      headers.set("cookie", merged.join("; "));
    }
    const response = await inner(input, { ...init, headers });
    const setCookies =
      typeof (response.headers as any).getSetCookie === "function"
        ? (response.headers as any).getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie")]
          : [];
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
