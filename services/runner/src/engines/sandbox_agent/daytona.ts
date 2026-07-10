import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createAcpFetch } from "./acp-fetch.ts";
import {
  uploadPiExtensionToSandbox,
  uploadSkillsToSandbox,
  uploadSystemPromptToSandbox,
} from "./pi-assets.ts";
import { shouldUploadOwnLogin, type RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

/** In-sandbox Pi agent dir on common Daytona images (daemon runs as user `sandbox`). */
export const DAYTONA_PI_DIR =
  process.env.AGENTA_AGENT_SANDBOX_PI_DIR ?? "/home/sandbox/.pi/agent";

// Keep fresh bare images reliable by installing Pi at session time by default. A
// snapshot that already bakes the pinned CLI can explicitly set
// AGENTA_AGENT_SANDBOX_PI_INSTALLED=false to skip that work.
export const DAYTONA_PI_INSTALL_DIR = "/home/sandbox/.agenta-pi";
export const DAYTONA_PI_INSTALL =
  process.env.AGENTA_AGENT_SANDBOX_PI_INSTALLED !== "false";
export const DAYTONA_PI_VERSION = process.env.AGENTA_AGENT_SANDBOX_PI_VERSION ?? "0.80.6";

/**
 * In-sandbox env for the Daytona daemon: where Pi reads its login, any provider keys,
 * and the Agenta extension env (traceparent + OTLP + tool spec) so the remote Pi traces
 * and runs tools exactly like local. No local-only paths (PATH/PI_ACP_PI_COMMAND) here.
 */
export function daytonaEnvVars(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {
    PI_CODING_AGENT_DIR: DAYTONA_PI_DIR,
    ...piExtEnv,
    // Provider API keys from the vault: the in-sandbox harness authenticates with these.
    ...secrets,
  };
  // Point pi-acp at the `pi` we install into the sandbox (the image lacks it).
  if (DAYTONA_PI_INSTALL) {
    env.PI_ACP_PI_COMMAND = `${DAYTONA_PI_INSTALL_DIR}/node_modules/.bin/pi`;
  }
  return env;
}


/** Install the `pi` CLI into a Daytona sandbox (the sandbox-agent image lacks it). Best-effort. */
export async function installPiInSandbox(sandbox: any, log: Log = () => {}): Promise<void> {
  try {
    await sandbox.mkdirFs({ path: DAYTONA_PI_INSTALL_DIR });
    const res = await sandbox.runProcess({
      command: "npm",
      args: [
        "install",
        "--no-fund",
        "--no-audit",
        `@earendil-works/pi-coding-agent@${DAYTONA_PI_VERSION}`,
      ],
      cwd: DAYTONA_PI_INSTALL_DIR,
      timeoutMs: 180_000,
    });
    if (res?.exitCode !== 0) {
      log(`pi install in sandbox exit=${res?.exitCode}: ${String(res?.stderr).slice(-400)}`);
    }
  } catch (err) {
    log(`pi install in sandbox skipped: ${(err as Error).message}`);
  }
}

/**
 * Upload the local Pi login into a Daytona sandbox so the remote Pi authenticates with
 * the dev's ChatGPT/Codex OAuth. Best-effort: with no local login the remote run falls
 * back to any provider key in the sandbox env.
 */
export async function uploadPiAuthToSandbox(sandbox: any, log: Log = () => {}): Promise<void> {
  const localDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi/agent");
  const authPath = join(localDir, "auth.json");
  if (!existsSync(authPath)) return;
  try {
    await sandbox.mkdirFs({ path: DAYTONA_PI_DIR });
    await sandbox.writeFsFile({ path: `${DAYTONA_PI_DIR}/auth.json` }, readFileSync(authPath, "utf-8"));
    const settingsPath = join(localDir, "settings.json");
    if (existsSync(settingsPath)) {
      await sandbox.writeFsFile(
        { path: `${DAYTONA_PI_DIR}/settings.json` },
        readFileSync(settingsPath, "utf-8"),
      );
    }
  } catch (err) {
    log(`pi auth upload skipped: ${(err as Error).message}`);
  }
}

export interface PrepareDaytonaPiAssetsInput {
  sandbox: any;
  plan: Pick<
    RunPlan,
    | "isPi"
    | "hasApiKey"
    | "credentialMode"
    | "skillDirs"
    | "hasSystemPrompt"
    | "systemPrompt"
    | "appendSystemPrompt"
  >;
  log?: Log;
}

/**
 * Push the Pi login fallback, Agenta extension, forced skills, system prompts, and optional
 * Pi CLI install into a Daytona sandbox.
 */
export async function prepareDaytonaPiAssets({
  sandbox,
  plan,
  log = () => {},
}: PrepareDaytonaPiAssetsInput): Promise<void> {
  if (!plan.isPi) return;

  // Upload Pi's fallback `auth.json` only when the harness owns its login (Security rule 6):
  // runtime_provided, or an un-migrated caller with no api key. A resolved key (credentialMode
  // "env") NEVER triggers the fallback. The decision lives in `shouldUploadOwnLogin` so the rule
  // is in one place and testable.
  if (shouldUploadOwnLogin(plan)) await uploadPiAuthToSandbox(sandbox, log);
  await uploadPiExtensionToSandbox(sandbox, DAYTONA_PI_DIR, log);
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
  if (DAYTONA_PI_INSTALL) await installPiInSandbox(sandbox, log);
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
export function createCookieFetch(inner: typeof fetch = createAcpFetch()): typeof fetch {
  const jar = new Map<string, Map<string, string>>(); // host -> (name -> "name=value")
  return async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const host = url.host;
    const cookies = jar.get(host);
    const headers = new Headers(init?.headers ?? (typeof input !== "string" ? input.headers : undefined));
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
        : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
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
