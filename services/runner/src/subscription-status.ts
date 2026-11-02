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
 * REDACTION IS THE CONTRACT. The result is a state word plus PROVIDER FAMILY names (`openai`,
 * `anthropic`) and nothing else: never an environment value, a path, a token, an account name, a
 * plan name, or a raw filesystem/parse error. The caller is a browser-facing status card; anything
 * richer than that is a leak. For the same reason nothing here logs. A family name is the one
 * thing read out of a login file, and only because a multi-provider harness (Pi) is otherwise
 * unattributable: the card cannot say WHICH plan is ready without it.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Response envelope version. Bump only for a shape change a v1 client could not read — an ADDED
 * optional field (`providers`) is not one: a v1 reader ignores it and gets the answer it expects.
 */
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

export const SUBSCRIPTION_HARNESSES = ["codex", "claude", "pi_core"] as const;
export type SubscriptionHarness = (typeof SUBSCRIPTION_HARNESSES)[number];

export interface HarnessSubscriptionStatus {
  state: SubscriptionState;
  /**
   * The provider this harness's subscription login belongs to. A CONSTANT of the harness, never
   * read out of the login file — so it carries no account information.
   */
  provider?: string;
  /**
   * For a harness whose login file can hold SEVERAL plans (Pi), the provider families it holds,
   * sorted and deduped. Family names only — the file's own provider ids, tokens, and account
   * fields never leave this module. Omitted when there is nothing to report, so a client that
   * never heard of the field reads the same answer it always did.
   */
  providers?: string[];
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
  /**
   * For a login file that can hold several plans: the provider families it holds. Runs only after
   * the state ladder said `ready`, and its failure is never the state's problem.
   */
  providersFrom?: (raw: string) => string[];
}

/**
 * Pi's `auth.json` is a map of PROVIDER ID -> login (`{type, ...credentials}`), so one Pi mount
 * can hold a ChatGPT plan and a Claude plan at once. These are the ids Pi writes for its OAuth
 * logins (`@earendil-works/pi-ai`, `utils/oauth`), mapped onto the provider families the vault
 * names. Anything else is ignored rather than guessed at: `github-copilot` is a real Pi login with
 * no provider family of ours, and an unknown id is a login we cannot name a plan for.
 */
const PI_PROVIDER_FAMILIES: Record<string, string> = {
  anthropic: "anthropic",
  "openai-codex": "openai",
};

/**
 * True for a SUBSCRIPTION login, not an API key. Pi stores both in the same file under the same
 * provider id, and a key is a vault connection the user pastes, not a plan they pay for — a row
 * calling it a ChatGPT subscription would be a lie. Pi tags what it writes (`type: "oauth"`); the
 * shape check covers a file written before it did.
 */
function isOAuthLogin(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const login = entry as Record<string, unknown>;
  return (
    login.type === "oauth" ||
    (typeof login.access === "string" && typeof login.refresh === "string")
  );
}

/** The provider families whose subscription logins Pi's `auth.json` holds. */
function piProviders(raw: string): string[] {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const families = new Set<string>();
  for (const [id, entry] of Object.entries(parsed)) {
    const family = PI_PROVIDER_FAMILIES[id];
    if (family && isOAuthLogin(entry)) families.add(family);
  }
  return [...families].sort();
}

// Pi is not tied to one provider, so it reports which families its login holds instead of a
// harness-constant `provider`.
const PI_PROBE: LoginProbe = {
  dirEnv: "PI_CODING_AGENT_DIR",
  file: "auth.json",
  providersFrom: piProviders,
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
  pi_core: PI_PROBE,
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

interface ProbeResult {
  state: SubscriptionState;
  /** The login file's text, kept only for a `ready` probe that has providers to read from it. */
  contents?: string;
}

/**
 * The reads are async so a hung or slow mount (a stalled network filesystem) blocks only this
 * request, never the runner's event loop and the runs sharing it.
 */
async function probeState(
  probe: LoginProbe,
  env: NodeJS.ProcessEnv,
): Promise<ProbeResult> {
  const dir = env[probe.dirEnv]?.trim();
  if (!dir) return { state: "not_configured" };
  // stat follows symlinks, so a Codex login reached through the runner-owned home's symlink
  // reports on the file the harness actually reads.
  const loginFile = join(dir, probe.file);
  try {
    if ((await stat(loginFile)).size === 0) return { state: "login_unusable" };
  } catch (err) {
    // Absent folder or absent file is `login_missing`. Anything else (a permission denial, a
    // broken mount) is a login we cannot use, which is a different fix for the operator.
    const code = (err as NodeJS.ErrnoException).code;
    return {
      state:
        code === "ENOENT" || code === "ENOTDIR"
          ? "login_missing"
          : "login_unusable",
    };
  }
  try {
    const contents = await readFile(loginFile, "utf8");
    return hasMinimumShape(contents)
      ? { state: "ready", contents }
      : { state: "login_unusable" };
  } catch {
    // Unreadable or not JSON. The error itself is dropped: it would carry the path.
    return { state: "login_unusable" };
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
  let result: ProbeResult;
  try {
    result = await probeState(probe, env);
  } catch {
    result = { state: "login_unusable" };
  }
  const status: HarnessSubscriptionStatus = probe.provider
    ? { state: result.state, provider: probe.provider }
    : { state: result.state };
  if (probe.providersFrom && result.contents !== undefined) {
    try {
      const providers = probe.providersFrom(result.contents);
      // An empty list is nothing to say, not a claim that the file holds no plans.
      if (providers.length) status.providers = providers;
    } catch {
      // A login the harness itself can use but we cannot attribute is still `ready`: naming its
      // plans is an extra, and losing it must never cost the state.
    }
  }
  return status;
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
