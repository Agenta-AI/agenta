import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  type AgentRunRequest,
  type ModelConnectionSubscription,
  type ResolvedToolSpec,
  type SandboxPermission,
  currentUserTurn,
  resolvePromptText,
} from "../../protocol.ts";
import { executableToolSpecs } from "../../tools/public-spec.ts";
import { attachmentCountError } from "../../sessions/attachments.ts";
import { harnessKindOf } from "../../harness-kind.ts";
import { CODE_TOOL_UNSUPPORTED_MESSAGE } from "../../tools/code.ts";
import { piGatewayMcpServersFromWire } from "../../extensions/pi-mcp.ts";
import {
  INTERNAL_TOOL_MCP_SERVER_NAME,
  RESERVED_MCP_SERVER_NAME_MESSAGE,
} from "./mcp.ts";
import {
  permissionsFromRequest,
  piBuiltinIdentity,
  type PermissionPlan,
} from "../../permission-plan.ts";
import {
  type MaterializedSkill,
  resolveSkillDirs as defaultResolveSkillDirs,
} from "../skills.ts";
import { assert } from "./capabilities.ts";
import type { ClientToolPauseDisposition } from "./client-tools.ts";
import { carriesApprovalReplyOnly } from "./session-identity.ts";
import { buildTurnText } from "./transcript.ts";
import {
  KNOWN_SANDBOX_PROVIDER_IDS,
  loadRunnerConfig,
  type SandboxProviderId,
} from "../../config/runner-config.ts";
import {
  buildDaytonaSecretPlan,
  daytonaOpaqueSecretsEnabled,
  type DaytonaSecretPlan,
} from "./daytona-secret-plan.ts";
import { materializeSandboxCredentials } from "./sandbox-credentials.ts";

type Log = (message: string) => void;

/**
 * Not-implemented sandbox-boundary gates. These mirror the code-tool gate
 * (`tools/code.ts` `CODE_TOOL_UNSUPPORTED_MESSAGE`): a declared capability the runner cannot
 * actually enforce fails loudly with a single named-constant message rather than being silently
 * accepted, so a run never proceeds believing a boundary holds when it does not.
 */

/** A restricted `network` policy on the LOCAL sandbox is not enforceable (no host egress control). */
export const LOCAL_NETWORK_UNSUPPORTED_MESSAGE =
  "Network sandbox policy is not enforceable on the local sandbox (the sidecar runs on this " +
  "host with no egress control); run on daytona, or remove sandbox_permission.network.";

/** `filesystem` confinement is declared on the wire but applied by no backend. */
export const FILESYSTEM_UNSUPPORTED_MESSAGE =
  "Filesystem sandbox policy is not implemented (no backend applies a filesystem jail); " +
  "remove sandbox_permission.filesystem.";

/**
 * A non-Pi harness (MCP-only tool delivery) on a NON-DAYTONA remote sandbox cannot receive
 * gateway/custom tools: the internal tool-MCP channel is either a runner-loopback HTTP server
 * (unreachable from inside a remote sandbox) or the in-sandbox stdio MCP shim, and the shim's
 * upload + spawn path is proven for Daytona only. The gate keys on "remote but not daytona"
 * so a NEW remote provider (e.g. the in-flight E2B one) fails closed with this error until
 * tool delivery is proven there, instead of silently re-opening the F1 zero-tools drop one
 * provider over (before this gate existed, the run proceeded, silently dropped every tool,
 * and returned ok:true).
 */
export const REMOTE_TOOLS_UNSUPPORTED_MESSAGE =
  "Tools are not supported for a non-Pi harness on this remote sandbox provider: in-sandbox " +
  "tool delivery (the stdio MCP shim feeding the file relay) is proven for Daytona only, so " +
  "other remote providers fail closed until it is proven there. Run on daytona or the local " +
  "sandbox, use the Pi harness, or remove the tools. Tracked in " +
  "docs/design/agent-workflows/projects/in-sandbox-tool-mcp/.";

/**
 * `runtime_provided` (subscription) auth means the harness authenticates from explicitly prepared
 * local runtime state (a mounted Pi/Claude login). That state lives only in the runner container
 * and is never shipped to a third-party sandbox (interface.md sections 5-6), so the combination is
 * unsupported on Daytona in version 1 rather than silently falling back to an unauthenticated run.
 */
export const DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE =
  "Daytona sandboxes do not support runtime-provided (subscription) authentication. " +
  "Use a managed API key (credentialMode 'env'), or run this harness on the local sandbox.";

/**
 * A local `runtime_provided` run reads the operator's subscription state from a read-write mount
 * named by the harness config var. With no mount configured there is nothing to authenticate
 * with, so the run fails up front (interface.md section 6) instead of silently proceeding and
 * having the harness discover the runner's own home directory.
 */
export const LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE =
  "runtime_provided local run requires a mounted subscription: set PI_CODING_AGENT_DIR " +
  "(Pi), CLAUDE_CONFIG_DIR (Claude), or CODEX_HOME (Codex) to a read-write mount of your harness login.";

/**
 * A delivered subscription block the runner cannot act on.
 *
 * The block carries the run's only credential, so a malformed one must stop the run rather than
 * fall through to the operator-mount path — that path would authenticate as the OPERATOR, on
 * someone else's connection, which is worse than a failed run.
 */
export const SUBSCRIPTION_INVALID_MESSAGE =
  "modelConnection.subscription is invalid: it needs an id (letters, digits, '.', '_' or '-'), " +
  "and a login with access, refresh, and a numeric expires.";

/**
 * The only harness and product family a hosted subscription run is implemented for.
 *
 * The runner materializes a ChatGPT-shaped `auth.json` into a Pi agent dir. Any other pair would
 * write a credential the harness does not read, and the run would authenticate as nobody while
 * looking configured. The SDK refuses these on the product path; this is the runner's own wire
 * boundary, which a direct `/run` caller reaches without passing through the SDK.
 */
export const SUBSCRIPTION_SUPPORTED_PROVIDER = "chatgpt";
export const SUBSCRIPTION_UNSUPPORTED_MESSAGE =
  "A subscription connection is supported only for the ChatGPT provider on a Pi harness. " +
  "Use a managed API key (credentialMode 'env') for anything else.";

/**
 * The id doubles as a directory name, so it must be one plain path segment and nothing else.
 *
 * `.` and `..` are spelled out of the character class because they pass every other test and then
 * collapse the per-connection home into its own parent: `..` makes the local home the runner state
 * dir itself and the Daytona home `/home/sandbox/agenta`. A run on such an id would write its
 * login into a directory shared with every other connection and clear prompt files there.
 */
const SUBSCRIPTION_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,128}$/;

/**
 * Where this runner keeps state that outlives a single run but is not session data.
 *
 * A subscription login lands under it, one directory per connection. It is deliberately NOT the
 * durable cwd: that is a geesefs mount into object storage, and a credential file there would be
 * both visible to the agent's own tools and subject to the degraded-symlink and non-atomic-write
 * hazards the Codex path already fights.
 */
export function runnerStateDir(): string {
  return (
    process.env.AGENTA_RUNNER_STATE_DIR?.trim() ||
    join(tmpdir(), "agenta", "runner-state")
  );
}

/**
 * The agent dir holding one subscription's login for this run.
 *
 * Local: under the runner's own state dir. Daytona: on the sandbox's in-VM disk, a sibling of the
 * Codex SQLite home, for the same reason that one is there — the geesefs cwd is the wrong
 * filesystem for a file the harness rewrites in place.
 *
 * Keyed by connection id, so two connections never share a login file and a warm sandbox cannot
 * serve the second one the first one's token.
 */
export function subscriptionHomeDir(id: string, isDaytona: boolean): string {
  return isDaytona
    ? `/home/sandbox/agenta/subscriptions/${id}`
    : join(runnerStateDir(), "subscriptions", id);
}

/** Whether a delivered subscription block is usable. Shape only; the provider judges the token. */
export function isUsableSubscription(
  subscription: ModelConnectionSubscription | undefined,
): boolean {
  if (!subscription) return false;
  if (!SUBSCRIPTION_ID_PATTERN.test(subscription.id ?? "")) return false;
  const login = subscription.login;
  if (typeof login !== "object" || login === null) return false;
  return (
    typeof login.access === "string" &&
    !!login.access &&
    typeof login.refresh === "string" &&
    !!login.refresh &&
    typeof login.expires === "number" &&
    Number.isFinite(login.expires)
  );
}

/**
 * How the run authenticates with the model provider. Everything here describes the credential
 * itself and how it is delivered, not where the run executes or what it asks the model to do.
 */
export interface RunPlanCredentials {
  /** Final plaintext model environment, after validating modelConnection. */
  modelEnvironment: Record<string, string>;
  sandboxEnvironment: Record<string, string>;
  /**
   * Process-local opaque credential plan. Present for every Daytona run unless credential
   * hiding was switched off with AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS, and present even with
   * zero candidates, so the Secret provider wrapper (and its create-fingerprint rotation
   * check) governs every reconnect. Absent only when hiding is off, and that path is the plain
   * plaintext-env provider with no wrapper, unchanged from the pre-feature runner.
   */
  daytonaSecretPlan?: DaytonaSecretPlan;
  /**
   * The provider api-key env var name the harness would read by default (`ANTHROPIC_API_KEY` for
   * Claude, `OPENAI_API_KEY` otherwise). It does not choose the provider; it only names the key
   * whose presence — in the materialized model environment — sets `hasApiKey`.
   */
  harnessApiKeyVar: string;
  /** Whether the materialized model environment already carries `harnessApiKeyVar`. */
  hasApiKey: boolean;
  /**
   * How the credential is delivered: "env" (managed, resolved key) | "runtime_provided" (the
   * harness owns its login) | "none". From the resolved connection (provider-model-auth design,
   * Concern 3). `undefined` only when a direct runner request has no resolved modelConnection;
   * that request may still use the harness login. Drives clear-then-apply env (Security rule 5).
   */
  credentialMode?: string;
  /**
   * The hosted subscription connection this run authenticates from, when it has one. Present only
   * alongside `credentialMode: "runtime_provided"`, and its presence is what separates a HOSTED
   * subscription run (the login rides the request, Daytona allowed) from the OPERATOR-mount run
   * this runner already served (the login is a mount on this box, local only).
   *
   * It holds the login itself. Nothing may put it in a log line, a trace, or an error message.
   */
  subscription?: ModelConnectionSubscription;
  /**
   * The agent dir this run's subscription login is materialized into. Set together with
   * `subscription` and never without it. Local runs get a runner-state path; Daytona runs get the
   * in-VM path the sandbox writes to. See `subscriptionHomeDir`.
   */
  subscriptionHome?: string;
}

/**
 * Where the run's files live and what gets materialized into them. These are the directories the
 * engine creates, mounts, writes into, and cleans up.
 */
export interface RunPlanWorkspace {
  cwd: string;
  relayDir: string;
  /** Ephemeral Pi telemetry IPC, sibling to relay and keyed to the same conversation cwd. */
  telemetryDir: string;
  /**
   * Where the in-sandbox stdio MCP shim assets (bundle + public-specs file) are uploaded on
   * the Daytona non-Pi executable-tools path (`uploadToolMcpAssets`). An ephemeral in-VM
   * SIBLING of the relay dir, keyed the same way: NOT inside the relay dir (the relay loop
   * sweeps and watches that dir, and the shim files would read as relay traffic) and NOT on
   * the durable geesefs cwd (a flaky mount would surface as ENOTCONN on the harness's spawn
   * of the shim).
   */
  toolMcpDir: string;
  usageOutPath?: string;
  skillDirs: MaterializedSkill[];
  /** "name: reason" per skill that did NOT materialize — stamped as `ag.meta.skills.dropped`. */
  skillsDropped: string[];
  /** Removes the per-run skills temp root. The engine runs it in its `finally` so it never leaks. */
  skillsCleanup: () => void;
  sourcePiAgentDir: string;
  /**
   * Generic harness-rendered files to materialize in the cwd before the session starts. Each
   * `{ path (relative to cwd), content }` was produced by the Python harness adapter (e.g. the
   * claude adapter renders `.claude/settings.json` from its permissions slice). `prepareWorkspace`
   * writes each entry blind — no harness knowledge on the runner.
   */
  harnessFiles?: Array<{ path: string; content: string }>;
}

/**
 * The tools this run offers the model and how they are delivered. It covers both the resolved
 * specs and the delivery switches the engine reads when it wires the relay and the gates.
 */
export interface RunPlanTools {
  toolSpecs: ResolvedToolSpec[];
  executableToolSpecs: ResolvedToolSpec[];
  /** True when the permission policy needs the extension to intercept Pi builtin calls. */
  builtinGatingActive: boolean;
  /**
   * The run's permission posture. `allow` is the only posture under which the runner executes
   * owner-authored startup code (`agent-files/.tools/setup.sh`) unattended; see
   * `agent-tools-setup.ts`.
   */
  permissionDefault: PermissionPlan["default"];
  useToolRelay: boolean;
  /**
   * How a parked client tool disposes of the turn and the in-sandbox shim's blocking call (closed
   * set: `ClientToolPauseDisposition`). Kept on the plan so a future harness, or the reserved warm
   * hold, is a local change rather than an `!isPi` test scattered across call sites. Today: Pi →
   * "pi-native", the non-Pi shim (Claude on Daytona) → "cold-acknowledge".
   */
  clientToolPauseDisposition: ClientToolPauseDisposition;
}

/**
 * Everything the model is told for this turn. It holds the user text alongside the rendered
 * transcript and the system instructions layered on top of it.
 */
export interface RunPlanPrompt {
  text: string;
  turnText: string;
  agentsMd?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  hasSystemPrompt: boolean;
}

export interface RunPlan {
  harness: string;
  acpAgent: string;
  sandboxId: string;
  isPi: boolean;
  isDaytona: boolean;
  credentials: RunPlanCredentials;
  workspace: RunPlanWorkspace;
  tools: RunPlanTools;
  prompt: RunPlanPrompt;
  /**
   * The declared sandbox security boundary (Layer 2). `buildSandboxProvider` enforces the
   * network policy on Daytona (S1b); `buildRunPlan` rejects restricted-network runs the
   * provider cannot make a hard guarantee for (local sidecar, or runner-host tools / stdio
   * MCP) when `enforcement === "strict"`.
   */
  sandboxPermission?: SandboxPermission;
}

export type BuildRunPlanResult =
  { ok: true; plan: RunPlan } | { ok: false; error: string };

// The five wire fields this change RETIRED. They are listed here so the runner can reject a
// request that still sends them, rather than ignore them.
//
// Why reject instead of ignore: an old caller sending `secrets: {OPENAI_API_KEY: "..."}` would
// otherwise get a run that starts fine and has no key, and the failure would surface much later
// as a confusing provider auth error. Rejecting turns a silent wrong-credential run into an
// immediate, obvious contract error. Nothing in the tree sends these; the SDK and the runner
// ship together, so this is a guard against a stale caller, not a compatibility shim, and it is
// not tied to the Daytona feature flag.
//
// `connection` is deliberately NOT in this list. It looks like it belongs (it was next to these
// fields on the old wire) but it is not a credential: it is the author's choice of which Agenta
// connection to use, as `{mode, slug}`. The runner still needs it, because a named
// OpenAI-compatible run on the Pi harness is registered in Pi's own `models.json` under a
// provider named after that slug (`pi-model-config.ts`). Dropping it makes those runs silently
// fall back to the generic provider-override path.
const LEGACY_MODEL_CREDENTIAL_FIELDS = [
  "secrets",
  "provider",
  "deployment",
  "credentialMode",
  "endpoint",
] as const;

// Always scans the raw request, `modelConnection` present or not: a caller sending BOTH the
// typed shape and a retired flat field is confused about the contract, and silently ignoring
// the legacy half could mask a credential it expected to apply.
function legacyModelCredentialFields(request: AgentRunRequest): string[] {
  const raw = request as unknown as Record<string, unknown>;
  return LEGACY_MODEL_CREDENTIAL_FIELDS.filter(
    (field) => Object.hasOwn(raw, field) && raw[field] !== undefined,
  );
}

export interface BuildRunPlanDeps {
  sandboxProvider?: string;
  /** Providers this deployment enables; a request for anything outside this set is rejected. */
  enabledProviders?: readonly SandboxProviderId[];
  createLocalCwd?: (durableCwd?: string) => string;
  createDaytonaCwd?: (durableCwd?: string) => string;
  /** Pre-computed durable cwd derived from the sign prefix; when set, skips the ephemeral helpers. */
  durableCwd?: string;
  resolveSkillDirs?: typeof defaultResolveSkillDirs;
  log?: Log;
}

/**
 * True when any resolved tool is a `code` tool. Code execution was removed for security
 * (F-010); the sidecar must refuse a run that carries one rather than advertise it and then
 * launder a per-call rejection into a "successful" reply (F-016).
 */
function hasCodeTool(specs: ResolvedToolSpec[]): boolean {
  return specs.some((spec) => spec.kind === "code");
}

function permissionRuleTargetsPiBuiltin(pattern: string): boolean {
  const open = pattern.indexOf("(");
  const toolName = open === -1 ? pattern : pattern.slice(0, open);
  return piBuiltinIdentity(toolName) !== undefined;
}

function computeBuiltinGatingActive(
  isPi: boolean,
  permissionPlan: PermissionPlan,
): boolean {
  if (!isPi) return false;
  try {
    if (permissionPlan.default !== "allow") return true;
    return permissionPlan.rules.some((rule) =>
      permissionRuleTargetsPiBuiltin(rule.pattern),
    );
  } catch {
    // A plan we cannot read gates rather than runs built-ins unattended.
    return true;
  }
}

function defaultLocalCwd(durableCwd?: string): string {
  // When the caller pre-computed a durable cwd from the sign prefix, use it — same prefix means
  // same mountpoint across turns, so checkMounted short-circuits and no geesefs leak accrues.
  if (durableCwd) {
    mkdirSync(durableCwd, { recursive: true });
    return durableCwd;
  }
  // Ephemeral fallback for non-session runs.
  return mkdtempSync(join(tmpdir(), "agenta-sandbox-agent-"));
}

function defaultDaytonaCwd(durableCwd?: string): string {
  // Daytona: the remote sandbox creates the dir via mkdir-p in mountStorageRemote; no mkdirSync.
  return durableCwd ?? `/home/sandbox/agenta-${randomBytes(6).toString("hex")}`;
}

// `host.docker.internal` is here for the same reason the Python SDK's `_LOOPBACK_HOSTNAMES`
// carries it: Docker exposes the host loopback to a container under that fixed alias, so a
// hop to it is the same hop. It was missing on this leg, which meant the SDK admitted a
// connection the runner then refused — the run reached the sandbox and died there.
const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
]);

/** The deployment opt-in that lets OUR gateway credentials cross plain HTTP to a routable
 * host. Mirrors the Python SDK's `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED`
 * (`connections/models.py`): with the flag off both legs refuse, with it on both allow, so a
 * run can never be admitted by one and stranded by the other. Default off, and deliberately
 * not consulted for a provider's own secret — that rule stays HTTPS-or-loopback always.
 * Read per call, because a container recreate is what changes it. */
function gatewayInsecureHttpAllowed(): boolean {
  const raw = (process.env.AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED ?? "")
    .trim()
    .toLowerCase();
  return (
    raw === "1" ||
    raw === "true" ||
    raw === "t" ||
    raw === "y" ||
    raw === "yes" ||
    raw === "on" ||
    raw === "enable" ||
    raw === "enabled"
  );
}

/** Mirrors the provider-credential transport rule in the Python SDK: HTTPS anywhere, or
 * plain HTTP to loopback, which has no remote to leak a provider credential to. */
function isEffectiveSecureEndpoint(baseUrl: string | undefined): boolean {
  try {
    const endpoint = new URL(baseUrl ?? "");
    if (!endpoint.hostname) return false;
    if (endpoint.protocol === "https:") return true;
    return (
      endpoint.protocol === "http:" &&
      LOOPBACK_HOSTNAMES.has(endpoint.hostname.replace(/^\[|\]$/g, ""))
    );
  } catch {
    return false;
  }
}

/** The env var a gateway credential's raw value lands in, for a harness config file (Pi
 * `models.json`, Codex `config.toml`) to reference by `$VAR` indirection rather than writing
 * the secret to disk — the same pattern `apiKeyEnv` already uses for provider keys. */
export const GATEWAY_CREDENTIALS_VALUE_ENV = "AGENTA_GATEWAY_CREDENTIALS_VALUE";

const HTTP_FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isSafeHttpHeader(name: string, value: string): boolean {
  return HTTP_FIELD_NAME.test(name) && !/[\r\n]/.test(value);
}

/** The gateway credentials as the header they belong in. The header counterpart of
 * `materializeModelEnvironment`; validated there, materialized here. */
export function materializeGatewayHeaders(
  request: AgentRunRequest,
): Record<string, string> {
  const credentials = request.modelConnection?.gatewayCredentials;
  if (
    !credentials?.header?.trim() ||
    !credentials.value ||
    !isSafeHttpHeader(credentials.header, credentials.value)
  ) {
    return {};
  }
  return { [credentials.header]: credentials.value };
}

export function materializeModelEnvironment(
  request: AgentRunRequest,
):
  | { ok: true; environment: Record<string, string>; credentialMode?: string }
  | { ok: false; error: string } {
  const connection = request.modelConnection;
  if (!connection) return { ok: true, environment: {} };
  if (!connection.provider?.trim() || !connection.deployment?.trim()) {
    return {
      ok: false,
      error: "modelConnection requires provider and deployment",
    };
  }

  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(connection.environment ?? {})) {
    if (!name.trim() || typeof value !== "string" || !value) {
      return {
        ok: false,
        error:
          "modelConnection environment requires non-empty names and values",
      };
    }
    environment[name] = value;
  }

  const credentials = Array.isArray(connection.credentials)
    ? connection.credentials
    : [];
  if (connection.credentialMode === "env" && credentials.length === 0) {
    return {
      ok: false,
      error: "modelConnection credentialMode env requires credentials",
    };
  }
  if (connection.credentialMode !== "env" && credentials.length > 0) {
    return {
      ok: false,
      error: "modelConnection credentials require credentialMode env",
    };
  }

  for (const credential of credentials) {
    const name = credential?.binding?.name;
    if (
      credential?.binding?.kind !== "environment" ||
      !name?.trim() ||
      !credential.value
    ) {
      return {
        ok: false,
        error: "modelConnection credential binding and value must be non-empty",
      };
    }
    if (
      credential.usage !== "opaque_http" &&
      credential.usage !== "local_use"
    ) {
      return {
        ok: false,
        error: "modelConnection credential usage is invalid",
      };
    }
    if (
      credential.usage === "opaque_http" &&
      !isEffectiveSecureEndpoint(connection.endpoint?.baseUrl)
    ) {
      return {
        ok: false,
        error:
          "opaque_http model credentials require an effective HTTPS endpoint",
      };
    }
    if (Object.hasOwn(environment, name)) {
      return {
        ok: false,
        error: `duplicate modelConnection environment binding '${name}'`,
      };
    }
    environment[name] = credential.value;
  }

  const gatewayCredentials = connection.gatewayCredentials;
  if (gatewayCredentials !== undefined) {
    if (
      !gatewayCredentials.header?.trim() ||
      !gatewayCredentials.value ||
      !isSafeHttpHeader(gatewayCredentials.header, gatewayCredentials.value)
    ) {
      return {
        ok: false,
        error:
          "gateway credentials require a valid header name and newline-free value",
      };
    }
    // Gateway credentials are bearer credentials too, so the transport rule that guards a
    // provider secret above guards them here. Without this the two legs disagreed: the SDK
    // refused a plain-http routable gateway while the runner accepted one, which is the
    // inconsistency `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED` now resolves in both directions.
    if (
      !isEffectiveSecureEndpoint(connection.endpoint?.baseUrl) &&
      !gatewayInsecureHttpAllowed()
    ) {
      return {
        ok: false,
        error:
          "gateway credentials require an effective HTTPS endpoint; serve the deployment " +
          "over HTTPS, or set AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED=true on a trusted " +
          "single-tenant deployment",
      };
    }
    // Gateway credentials replace provider credentials for a gateway-routed connection.
    if (credentials.length > 0) {
      return {
        ok: false,
        error:
          "modelConnection cannot combine gateway credentials with provider credentials",
      };
    }
  }

  return {
    ok: true,
    environment,
    credentialMode: connection.credentialMode,
  };
}

export function buildRunPlan(
  request: AgentRunRequest,
  {
    sandboxProvider,
    enabledProviders,
    createLocalCwd = defaultLocalCwd,
    createDaytonaCwd = defaultDaytonaCwd,
    durableCwd,
    resolveSkillDirs = defaultResolveSkillDirs,
    log = () => {},
  }: BuildRunPlanDeps = {},
): BuildRunPlanResult {
  const runnerConfig = loadRunnerConfig();
  const defaultProvider = sandboxProvider ?? runnerConfig.providers.default;
  const enabled = enabledProviders ?? runnerConfig.providers.enabled;
  // Fail CLOSED on a non-string harness, matching `harnessKindOf`: `/stream` decodes with an
  // unchecked `JSON.parse`, so a malformed payload can put `null`, `0`, or `false` here, and a
  // bare `||` would quietly run it as Pi while the lifecycle router classifies it `unknown`.
  if (request.harness !== undefined && typeof request.harness !== "string") {
    return {
      ok: false,
      error: `Unrecognized harness ${JSON.stringify(request.harness)}: not a string.`,
    };
  }
  if (
    request.platformInstructions !== undefined &&
    typeof request.platformInstructions !== "string"
  ) {
    return {
      ok: false,
      error: "platformInstructions must be a string when provided.",
    };
  }
  const harness = request.harness || "pi_core";
  const sandboxId = request.sandbox || defaultProvider || "local";

  // Deployment posture gate (interface.md section 2, rule 7): a request for a known but disabled
  // provider fails here, before any cwd/temp dir, mount, file, secret, or sandbox is created.
  // There is no silent fallback to another provider.
  if (
    (KNOWN_SANDBOX_PROVIDER_IDS as readonly string[]).includes(sandboxId) &&
    !enabled.includes(sandboxId as SandboxProviderId)
  ) {
    return {
      ok: false,
      error:
        `Sandbox provider '${sandboxId}' is not enabled on this deployment ` +
        `(enabled: ${enabled.join(", ")}).`,
    };
  }

  // Model routing and credentials arrive grouped under `modelConnection`; the retired flat
  // fields are rejected loudly so a stale caller cannot silently run without credentials.
  const legacyFields = legacyModelCredentialFields(request);
  if (legacyFields.length > 0) {
    return {
      ok: false,
      error:
        `Legacy top-level model credential fields are not supported (${legacyFields.join(", ")}); ` +
        "send the resolved modelConnection object.",
    };
  }

  // The harness identity maps to a real ACP agent the daemon knows (`pi` / `claude`).
  // `pi_agenta` (a removed experiment: Pi plus a forced Agenta overlay) is read as Pi so an
  // old stored request or replay still runs; the mapping is `harnessKindOf`, THE shared
  // normalizer — `pi_core` and that legacy spelling both
  // run on the `pi` ACP agent; `claude` runs on the `claude` ACP agent. `harness` remains the
  // selected identity for logs, traces, and user-facing errors.
  const acpAgent = harnessKindOf(harness) === "pi" ? "pi" : harness;

  // Debug assertion: every Pi identity must resolve to the `pi` ACP agent and nothing else may.
  // Catches a future harness-id typo (e.g. a new `pi_*` value forgotten here) at plan-build time
  // rather than as a daemon "unknown agent" error mid-run.
  assert(
    (harnessKindOf(harness) === "pi") === (acpAgent === "pi"),
    `harness '${harness}' resolved to ACP agent '${acpAgent}', but pi identity mapping disagrees`,
  );

  const turn = currentUserTurn(request);
  const attachmentError = attachmentCountError(turn.attachments.length);
  if (attachmentError) return { ok: false, error: attachmentError };
  const prompt = turn.text;
  // An out-of-band approval reply legitimately carries no user text: the human answered a parked
  // gate from the durable interaction row, not from the conversation. Its prior turns are rebuilt
  // from the record log inside `runTurn` (`reconstructHistoryIfNeeded`), which runs AFTER this
  // plan is built — so rejecting here would kill the run before the conversation could be
  // supplied. A historical user prompt also keeps structured continuation tails valid; only a
  // request with no current attachment, no approval reply, and no user text anywhere is rejected.
  if (
    !turn.text &&
    turn.attachments.length === 0 &&
    !turn.hasInlineMedia &&
    !resolvePromptText(request) &&
    !carriesApprovalReplyOnly(request)
  ) {
    return {
      ok: false,
      error: "No user message to send (prompt/messages empty).",
    };
  }

  const isPi = acpAgent === "pi";
  const isDaytona = sandboxId === "daytona";
  // Any non-local sandbox counts as remote for the F1 tools gate below. An unknown provider id
  // currently falls through to the LOCAL cwd/provider path further down, but for tool delivery
  // it must fail CLOSED: a future provider (E2B et al.) has no proven delivery path until it
  // ships one, and "unknown" must not silently behave like "reachable loopback".
  const isRemoteSandbox = sandboxId !== "local";

  // TWO SHAPES OF `runtime_provided`, told apart by `modelConnection.subscription`.
  //
  // HOSTED (the block is present): the API delivers the login with the request and the runner
  // materializes it into a per-connection agent dir. Nothing is read off an operator mount, so the
  // mount gate below does not apply, and the login CAN be delivered into a Daytona sandbox because
  // it belongs to the project rather than to this box — which is what the old Daytona rejection
  // existed to prevent.
  //
  // OPERATOR MOUNT (no block): unchanged. Local only, and the harness config var must name a
  // read-write mount of the operator's own login.
  const requestCredentialMode = request.modelConnection?.credentialMode;
  const requestSubscription = request.modelConnection?.subscription;
  if (requestCredentialMode === "runtime_provided" && requestSubscription) {
    // A malformed block is terminal. Falling through would run on the operator's mount instead,
    // which authenticates as the wrong account.
    if (!isUsableSubscription(requestSubscription)) {
      return { ok: false, error: SUBSCRIPTION_INVALID_MESSAGE };
    }
    if (
      !isPi ||
      requestSubscription.provider?.trim().toLowerCase() !==
        SUBSCRIPTION_SUPPORTED_PROVIDER
    ) {
      return { ok: false, error: SUBSCRIPTION_UNSUPPORTED_MESSAGE };
    }
  } else if (requestSubscription) {
    // A subscription with any other credential mode is a caller that half-migrated. Refuse rather
    // than pick one of the two credentials it now carries.
    return {
      ok: false,
      error:
        "modelConnection.subscription requires credentialMode 'runtime_provided'.",
    };
  } else if (requestCredentialMode === "runtime_provided") {
    if (isDaytona) {
      return { ok: false, error: DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE };
    }
    const subscriptionEnvVar =
      acpAgent === "claude"
        ? "CLAUDE_CONFIG_DIR"
        : acpAgent === "codex"
          ? "CODEX_HOME"
          : "PI_CODING_AGENT_DIR";
    if (!process.env[subscriptionEnvVar]) {
      return { ok: false, error: LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE };
    }
  }
  const subscription =
    requestCredentialMode === "runtime_provided"
      ? requestSubscription
      : undefined;

  const materializedModel = materializeModelEnvironment(request);
  if (!materializedModel.ok) return materializedModel;
  const materializedSandbox = materializeSandboxCredentials(request);
  if (!materializedSandbox.ok) return materializedSandbox;
  // Daytona opaque-credential delivery is ON by default and switched off only by
  // AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS. Switched OFF: no secret plan is built at all, so
  // behavior is identical to the pre-feature runner — the full materialized environment reaches
  // sandbox create as plaintext env, no provider wrapper is applied, and the plan's strict
  // endpoint/binding validation cannot introduce a new failure mode. ON (the default): the plan
  // splits every opaque_http value out of the plaintext env and is ALWAYS kept, even with zero
  // candidates, so the provider wrapper (and its create fingerprint) governs every Daytona
  // reconnect that hides credentials. A zero-candidate plan
  // allocates no Secrets, but a parked sandbox created with plaintext local_use credentials must
  // be rebuilt — never reconnected — after those credentials rotate, and only the wrapper's
  // fingerprint check enforces that (the plain reconnect path converges network policy only).
  let daytonaSecretPlan: DaytonaSecretPlan | undefined;
  if (isDaytona && daytonaOpaqueSecretsEnabled()) {
    try {
      daytonaSecretPlan = buildDaytonaSecretPlan({
        modelConnection: request.modelConnection,
        mcpServers: request.mcpServers,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  // Local keeps its existing direct environment. A Daytona run that hides opaque credentials
  // removes every opaque_http value and passes only non-secret config plus explicitly local_use
  // credentials to sandbox create. With zero candidates the plan's environment equals the
  // materialized one, so keeping the empty plan changes nothing here.
  const modelEnvironment =
    daytonaSecretPlan?.environment ?? materializedModel.environment;
  const harnessApiKeyVar =
    acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const toolSpecs = (request.customTools as ResolvedToolSpec[]) ?? [];
  const executableToolSpecsForRun = executableToolSpecs(toolSpecs);
  const permissionPlan = permissionsFromRequest(request);
  const builtinGatingActive = computeBuiltinGatingActive(isPi, permissionPlan);

  // Not-implemented boundary gates (sidecar-trust Part 2): a declared capability the runner
  // cannot actually enforce fails loudly, the way code tools do (`tools/code.ts`), rather than
  // being silently accepted. These fire BEFORE any cwd is created (so a rejected run never
  // orphans a temp dir) and are unconditional — `enforcement` is no longer the escape hatch,
  // because the boundary is not applied on any path regardless of strict/best_effort.

  // `filesystem` confinement is declared on the wire but applied by no backend. Specifying it
  // therefore errors everywhere; do not pretend a jail exists.
  if (request.sandboxPermission?.filesystem !== undefined) {
    return { ok: false, error: FILESYSTEM_UNSUPPORTED_MESSAGE };
  }

  // A restricted `network` policy on the LOCAL sandbox cannot be enforced (the sidecar runs on
  // this host with no per-run egress control), so it errors regardless of `enforcement`. On
  // Daytona the policy IS applied (`provider.ts` `daytonaNetworkFields`).
  const network = request.sandboxPermission?.network;
  const networkRestricted = !!network && (network.mode ?? "on") !== "on";
  if (networkRestricted && !isDaytona) {
    return { ok: false, error: LOCAL_NETWORK_UNSUPPORTED_MESSAGE };
  }

  // Code tools were removed (F-010 security): the sidecar no longer executes author-supplied
  // snippets. The dispatch sites still throw per-call as a backstop, but a per-call throw
  // becomes a tool RESULT the model launders into an `ok:true` reply ("Code tools are not
  // supported by the sidecar."), so a removed capability reads as a SUCCESS at the response
  // envelope (F-016). Fail loud up-front instead: refuse any run that carries a `code` tool,
  // the way stdio MCP is gated. Keep the wire shape; the delivery is not supported.
  if (hasCodeTool(toolSpecs)) {
    return { ok: false, error: CODE_TOOL_UNSUPPORTED_MESSAGE };
  }

  // Pi delivers tools through its bundled extension, not over ACP MCP, so a user MCP server it
  // cannot express is DROPPED by `buildSessionMcpServers`, and dropping it silently (no log,
  // HTTP 200) is the F-032 silent-drop bug. Pi's native extension CAN register HTTP MCP tools,
  // but only for the already-resolved Agenta gateway route shape. Validate up front, before any
  // run state is allocated, so an unsupported server fails loud here and a forged direct
  // upstream URL cannot become a Pi extension input.
  if (isPi) {
    try {
      piGatewayMcpServersFromWire(request.mcpServers);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // The internal gateway-tool channel's name is reserved on every transport: the Python
  // Claude adapter renders permission rules against `agenta-tools`, so a user server with
  // that name would collide with the internal channel and inherit/steal its rendered rules.
  // Refuse at declaration time; `buildSessionMcpServers` repeats the check at session
  // materialization as defense in depth.
  if (
    (request.mcpServers ?? []).some(
      (server) => server.name === INTERNAL_TOOL_MCP_SERVER_NAME,
    )
  ) {
    return { ok: false, error: RESERVED_MCP_SERVER_NAME_MESSAGE };
  }

  // Non-Pi + remote + tools: executable and client tools are both deliverable on Daytona via the
  // in-sandbox stdio MCP shim. A non-Daytona remote provider fails CLOSED because the shim's
  // upload + spawn path is proven for Daytona only.
  if (!isPi && isRemoteSandbox && !isDaytona && toolSpecs.length > 0) {
    return { ok: false, error: REMOTE_TOOLS_UNSUPPORTED_MESSAGE };
  }

  // Layer 2: even on Daytona, code/gateway tools run on the RUNNER HOST via the relay, not
  // inside the sandbox, so they bypass the sandbox network boundary. Under `strict` + a
  // restricted network, refuse them; `best_effort` is the opt-out that accepts the boundary is
  // not a hard guarantee.
  // Default to strict when `enforcement` is omitted, matching the documented wire schema
  // (`WireSandboxPermission.enforcement` defaults to "strict"). The Python service always fills
  // "strict", so the live path is unchanged; this aligns a DIRECT runner caller (and the
  // omit-when-default goldens) so only an explicit "best_effort" opts out of the hard guarantee.
  const strict = request.sandboxPermission?.enforcement !== "best_effort";
  if (networkRestricted && isDaytona && strict) {
    const mode = network?.mode ?? "on";
    if (executableToolSpecsForRun.length > 0) {
      return {
        ok: false,
        error:
          `code/gateway tools run on the runner host and would bypass the sandbox network ` +
          `boundary; remove them, or set enforcement=best_effort to accept that ` +
          `network:${mode} is not a hard guarantee.`,
      };
    }
  }

  const cwd = isDaytona
    ? createDaytonaCwd(durableCwd)
    : createLocalCwd(durableCwd);
  // The tool-relay scratch (req/res JSON) is ephemeral runner<->child IPC, NOT durable session
  // data — keep it OFF the geesefs-mounted cwd. A relay dir inside the mount routes every tool
  // call through FUSE/S3, so a flaky mount surfaces as ENOTCONN on the relay file. Use an
  // ephemeral sibling: a plain host tmp dir (local) or an in-VM dir (daytona), never the mount.
  const relayBase = isDaytona
    ? "/home/sandbox/agenta/relay"
    : join(tmpdir(), "agenta", "relay");
  const relayDir = join(relayBase, basename(cwd));
  const telemetryBase = isDaytona
    ? "/home/sandbox/agenta/telemetry"
    : join(tmpdir(), "agenta", "telemetry");
  const telemetryDir = join(telemetryBase, basename(cwd));
  // The in-sandbox stdio MCP shim assets live in an ephemeral SIBLING of the relay dir, keyed
  // the same way (stable across turns of one conversation). Never inside the relay dir — the
  // relay loop sweeps/watches it — and never on the geesefs mount (see `toolMcpDir` docs).
  const toolMcpBase = isDaytona
    ? "/home/sandbox/agenta/tool-mcp"
    : join(tmpdir(), "agenta", "tool-mcp");
  const toolMcpDir = join(toolMcpBase, basename(cwd));

  // Skills materialize once from the resolved inline packages. Pi/Agenta consume the dirs
  // through Pi's agent-dir user scope; Claude consumes the same packages from the project-local
  // `.claude/skills` tree that `prepareWorkspace` writes below.
  const {
    skills: skillDirs,
    dropped: skillsDropped,
    cleanup: skillsCleanup,
  } = resolveSkillDirs(request.skills, log);
  if (skillDirs.length > 0)
    log(`skills: ${skillDirs.map((s) => s.name).join(", ")}`);

  const systemPrompt = isPi
    ? request.systemPrompt?.trim() || undefined
    : undefined;
  // SDK-owned platform instructions are spliced HERE, at environment build time, before the
  // author's text. The runner owns the harness delivery choice: Pi uses its append-system prompt;
  // Claude and Codex use their rendered instructions file. Keep accepting the old carrier-bearing
  // field during the rolling deployment, but prefer the new field so a mixed request cannot
  // duplicate guidance. Both inputs remain outside session identity to preserve today's warm
  // behavior: generated guidance changes take effect on the next ordinary environment build.
  const platformInstructions =
    request.platformInstructions !== undefined
      ? request.platformInstructions.trim() || undefined
      : request.gatewayGuidance?.text?.trim() || undefined;
  const splicePlatformInstructions = (
    authored: string | undefined,
  ): string | undefined =>
    platformInstructions
      ? authored
        ? `${platformInstructions}\n\n${authored}`
        : platformInstructions
      : authored;
  const appendSystemPrompt = isPi
    ? splicePlatformInstructions(
        request.appendSystemPrompt?.trim() || undefined,
      )
    : undefined;

  // Debug assertions: the derived run state must be self-consistent before the engine acts on
  // it. A cwd that is empty, or a relay dir not nested under it, would only surface later as a
  // confusing filesystem error inside the sandbox.
  assert(!!cwd, `buildRunPlan produced an empty cwd for harness '${harness}'`);
  assert(
    !!relayDir && relayDir !== cwd,
    `relay dir '${relayDir}' must be a distinct ephemeral dir, not the durable cwd`,
  );
  assert(
    !!telemetryDir &&
      telemetryDir !== cwd &&
      telemetryDir !== relayDir &&
      !telemetryDir.startsWith(`${relayDir}/`),
    `telemetry dir '${telemetryDir}' must be an ephemeral sibling of the relay dir`,
  );
  assert(
    !!toolMcpDir &&
      toolMcpDir !== cwd &&
      toolMcpDir !== relayDir &&
      !toolMcpDir.startsWith(`${relayDir}/`),
    `tool MCP dir '${toolMcpDir}' must be an ephemeral sibling of the relay dir — never the ` +
      `durable cwd, the relay dir, or nested inside it (the relay loop sweeps that dir)`,
  );
  assert(
    isPi === (acpAgent === "pi"),
    `isPi (${isPi}) disagrees with acpAgent '${acpAgent}'`,
  );

  return {
    ok: true,
    plan: {
      harness,
      acpAgent,
      sandboxId,
      isPi,
      isDaytona,
      credentials: {
        modelEnvironment,
        sandboxEnvironment: materializedSandbox.environment,
        daytonaSecretPlan,
        harnessApiKeyVar,
        // Consult the FULL materialized environment: on a Daytona Secrets run the opaque key is
        // delivered as a Secret attachment rather than plaintext env, but the harness still has it.
        hasApiKey: !!materializedModel.environment[harnessApiKeyVar],
        credentialMode: materializedModel.credentialMode,
        subscription,
        subscriptionHome: subscription
          ? subscriptionHomeDir(subscription.id, isDaytona)
          : undefined,
      },
      workspace: {
        cwd,
        relayDir,
        telemetryDir,
        toolMcpDir,
        // Usage capture is ephemeral runner output, not durable session data — keep it off the
        // geesefs mount in Pi's always-created telemetry dir. A plain chat has no tool relay, so
        // the relay dir may not exist at all.
        usageOutPath: isPi
          ? join(telemetryDir, ".agenta-usage.json")
          : undefined,
        skillDirs,
        skillsDropped,
        skillsCleanup,
        sourcePiAgentDir:
          process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
        // Generic: the Python harness adapter already rendered any harness config files; the
        // runner just carries them onto the plan and writes them into the cwd in
        // `prepareWorkspace`.
        harnessFiles: request.harnessFiles,
      },
      tools: {
        toolSpecs,
        executableToolSpecs: executableToolSpecsForRun,
        builtinGatingActive,
        permissionDefault: permissionPlan.default,
        // The relay carries tool EXECUTION only (permission gates ride the extension's
        // `ctx.ui.confirm` dialog onto the ACP plane), so a builtin-gating-only run needs no relay.
        useToolRelay: toolSpecs.length > 0,
        // Pi parks through its own extension (no answer file); the non-Pi shim blocks on an answer
        // file, so a parked client tool is acknowledged with a benign paused answer.
        clientToolPauseDisposition: isPi ? "pi-native" : "cold-acknowledge",
      },
      prompt: {
        text: prompt,
        turnText: buildTurnText(request, log),
        agentsMd: isPi
          ? request.agentsMd?.trim() || undefined
          : splicePlatformInstructions(request.agentsMd?.trim() || undefined),
        systemPrompt,
        appendSystemPrompt,
        hasSystemPrompt: !!(systemPrompt || appendSystemPrompt),
      },
      sandboxPermission: request.sandboxPermission,
    },
  };
}
