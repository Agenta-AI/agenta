/**
 * Subscription login status, per harness.
 *
 * A "subscription" run authenticates from the operator's own harness login on a mounted folder
 * (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`) instead of a project API key. When
 * that mount is absent or the login file is unusable, the run fails deep inside the harness with
 * an error the user cannot act on. This module answers the same question up front, cheaply: does
 * this runner hold a login this harness could use?
 *
 * It is a LOCAL FILE CHECK, not a provider check. `ready` means "a login file exists here and
 * parses"; it does NOT mean the subscription is active or the token still valid — only a real run
 * proves that. The shape check follows the precedent in `engines/sandbox_agent/codex-assets.ts`
 * (`describeCodexSubscriptionAuthFault`): a 0-byte or unreadable login is the failure operators
 * actually hit, because Codex rewrites `auth.json` in place and a degraded mount leaves it empty.
 *
 * REDACTION IS THE CONTRACT. The result is a state word (plus a constant provider name) and
 * nothing else: never an environment value, a path, a token, an account name, a plan name, or a
 * raw filesystem/parse error. The caller is a browser-facing status card; anything richer than a
 * state word is a leak. For the same reason nothing here logs.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Response envelope version. Bump only for a shape change a v1 client could not read. */
export const SUBSCRIPTION_STATUS_VERSION = 1;

export type SubscriptionState =
  /** The mount variable is set, the login file exists and passes the local shape check. */
  | "ready"
  /** No mount variable for this harness: subscription auth was never configured. */
  | "not_configured"
  /** The mount is configured, but the expected login file is not there. */
  | "login_missing"
  /** The login file is empty, unreadable, or does not have the minimum expected shape. */
  | "login_unusable"
  /** This runner version cannot check this harness. */
  | "unsupported";

export const SUBSCRIPTION_HARNESSES = [
  "codex",
  "claude",
  "pi_core",
  "pi_agenta",
] as const;
export type SubscriptionHarness = (typeof SUBSCRIPTION_HARNESSES)[number];

export interface HarnessSubscriptionStatus {
  state: SubscriptionState;
  /**
   * The provider this harness's subscription login belongs to. A CONSTANT of the harness, never
   * read out of the login file — so it carries no account information.
   */
  provider?: string;
}

export interface SubscriptionStatusResponse {
  version: number;
  harnesses: Record<SubscriptionHarness, HarnessSubscriptionStatus>;
}

interface LoginProbe {
  /** The mount variable an operator points at the harness's login directory. */
  dirEnv: string;
  /** The login artifact inside that directory. */
  file: string;
  /** Omitted when the harness is not tied to one provider. */
  provider?: string;
}

// Pi can hold logins for more than one provider, so v1 reports one state and no provider
// rather than a provider map.
const PI_PROBE: LoginProbe = {
  dirEnv: "PI_CODING_AGENT_DIR",
  file: "auth.json",
};

const PROBES: Record<SubscriptionHarness, LoginProbe> = {
  codex: { dirEnv: "CODEX_HOME", file: "auth.json", provider: "openai" },
  // Claude reads and refreshes its OAuth credentials directly on the mount (see
  // environment-setup.ts); `.credentials.json` is the file that holds them.
  claude: {
    dirEnv: "CLAUDE_CONFIG_DIR",
    file: ".credentials.json",
    provider: "anthropic",
  },
  // `pi_core` and `pi_agenta` both drive the ACP agent "pi" (see run-plan.ts), so they read the
  // same login on the same mount: one probe, reported once per harness.
  pi_core: PI_PROBE,
  pi_agenta: PI_PROBE,
};

/**
 * The minimum shape: parses as JSON and is a non-empty object. Deliberately shallow — asserting
 * on specific keys would couple the runner to each harness's private credential format, and a
 * harness that renames a field would start reporting a usable login as broken.
 */
function hasMinimumShape(raw: string): boolean {
  const parsed = JSON.parse(raw) as unknown;
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length > 0
  );
}

/**
 * The reads are async so a hung or slow mount (a stalled network filesystem) blocks only this
 * request, never the runner's event loop and the runs sharing it.
 */
async function probeState(
  probe: LoginProbe,
  env: NodeJS.ProcessEnv,
): Promise<SubscriptionState> {
  const dir = env[probe.dirEnv]?.trim();
  if (!dir) return "not_configured";
  // stat follows symlinks, so a Codex login reached through the runner-owned home's symlink
  // reports on the file the harness actually reads.
  const loginFile = join(dir, probe.file);
  try {
    if ((await stat(loginFile)).size === 0) return "login_unusable";
  } catch (err) {
    // Absent folder or absent file is `login_missing`. Anything else (a permission denial, a
    // broken mount) is a login we cannot use, which is a different fix for the operator.
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR"
      ? "login_missing"
      : "login_unusable";
  }
  try {
    return hasMinimumShape(await readFile(loginFile, "utf8"))
      ? "ready"
      : "login_unusable";
  } catch {
    // Unreadable or not JSON. The error itself is dropped: it would carry the path.
    return "login_unusable";
  }
}

/**
 * The status of one harness. Never throws: a harness this runner cannot check is `unsupported`,
 * and a check that fails unexpectedly is `login_unusable`, so one broken harness can never stop
 * the others.
 */
export async function harnessSubscriptionStatus(
  harness: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HarnessSubscriptionStatus> {
  const probe = PROBES[harness as SubscriptionHarness];
  if (!probe) return { state: "unsupported" };
  let state: SubscriptionState;
  try {
    state = await probeState(probe, env);
  } catch {
    state = "login_unusable";
  }
  return probe.provider ? { state, provider: probe.provider } : { state };
}

/** The `GET /subscription-status` body: one state per harness this runner knows how to check. */
export async function subscriptionStatusResponse(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SubscriptionStatusResponse> {
  const harnesses = {} as Record<
    SubscriptionHarness,
    HarnessSubscriptionStatus
  >;
  for (const harness of SUBSCRIPTION_HARNESSES) {
    harnesses[harness] = await harnessSubscriptionStatus(harness, env);
  }
  return { version: SUBSCRIPTION_STATUS_VERSION, harnesses };
}
