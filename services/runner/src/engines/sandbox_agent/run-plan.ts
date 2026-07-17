import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  type AgentRunRequest,
  type ResolvedToolSpec,
  type SandboxPermission,
  resolvePromptText,
} from "../../protocol.ts";
import { executableToolSpecs } from "../../tools/public-spec.ts";
import { CODE_TOOL_UNSUPPORTED_MESSAGE } from "../../tools/code.ts";
import { PI_USER_MCP_UNSUPPORTED_MESSAGE } from "../../tools/mcp-bridge.ts";
import {
  INTERNAL_TOOL_MCP_SERVER_NAME,
  RESERVED_MCP_SERVER_NAME_MESSAGE,
} from "./mcp.ts";
import {
  PI_BUILTIN_TOOL_IDENTITY,
  permissionsFromRequest,
  piBuiltinIdentity,
  type PermissionPlan,
} from "../../permission-plan.ts";
import {
  type MaterializedSkill,
  resolveSkillDirs as defaultResolveSkillDirs,
} from "../skills.ts";
import { assert } from "./capabilities.ts";
import { buildTurnText } from "./transcript.ts";
import {
  KNOWN_SANDBOX_PROVIDER_IDS,
  loadRunnerConfig,
  type SandboxProviderId,
} from "../../config/runner-config.ts";

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
 * A non-Pi harness (Claude) on Daytona receives tools through the in-sandbox stdio MCP shim,
 * which advertises only EXECUTABLE (gateway/callback) tools. Client tools are intentionally
 * omitted: the shim's blocking relay call cannot pause for a browser round-trip yet. So a run
 * whose ENTIRE tool set is client-kind has nothing deliverable to advertise on Daytona — it
 * would otherwise proceed, drop every tool silently, and return `ok:true` (the F1 zero-tools
 * drop). `run-plan.ts` is the documented refusal point for this (see `mcp.ts`); refuse it up
 * front, exactly as the non-Daytona remote case is refused. A MIX of client + executable tools
 * is fine (the executable ones are delivered; the client ones are dropped), so this fires only
 * when NO executable tool remains.
 */
export const DAYTONA_CLIENT_ONLY_TOOLS_UNSUPPORTED_MESSAGE =
  "Client tools are not deliverable to a non-Pi harness on Daytona: the in-sandbox stdio MCP " +
  "shim advertises only executable (gateway/callback) tools, and a client tool cannot pause " +
  "for a browser round-trip through its blocking relay yet. This run's tool set is entirely " +
  "client-kind, so nothing would be advertised and the run would silently get zero tools. Add " +
  "an executable tool, use the Pi harness, run on the local sandbox, or remove the tools. " +
  "Tracked in docs/design/agent-workflows/projects/in-sandbox-tool-mcp/.";

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
  "(Pi) or CLAUDE_CONFIG_DIR (Claude) to a read-write mount of your harness login.";

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
  /**
   * The provider api-key env var name the harness would read by default (`ANTHROPIC_API_KEY` for
   * Claude, `OPENAI_API_KEY` otherwise). It does not choose the provider; it only names the key
   * whose presence sets `hasApiKey`.
   */
  legacyHarnessApiKeyVar: string;
  /** Whether the resolved `secrets` already carry `legacyHarnessApiKeyVar`. */
  hasApiKey: boolean;
  /**
   * How the credential is delivered: "env" (managed, resolved key) | "runtime_provided" (the
   * harness owns its login) | "none". From the resolved connection (provider-model-auth design,
   * Concern 3). `undefined` when an un-migrated caller sends no credentialMode. Drives
   * clear-then-apply env (Security rule 5).
   */
  credentialMode?: string;
  cwd: string;
  relayDir: string;
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
  toolSpecs: ResolvedToolSpec[];
  executableToolSpecs: ResolvedToolSpec[];
  /** Normalized Pi builtin grants for the extension active-tool edit. */
  builtinGrants: string[];
  /** True when Pi builtin grants or permissions need extension enforcement. */
  builtinGatingActive: boolean;
  useToolRelay: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  hasSystemPrompt: boolean;
  skillDirs: MaterializedSkill[];
  /** Removes the per-run skills temp root. The engine runs it in its `finally` so it never leaks. */
  skillsCleanup: () => void;
  sourcePiAgentDir: string;
  /**
   * The declared sandbox security boundary (Layer 2). `buildSandboxProvider` enforces the
   * network policy on Daytona (S1b); `buildRunPlan` rejects restricted-network runs the
   * provider cannot make a hard guarantee for (local sidecar, or runner-host tools / stdio
   * MCP) when `enforcement === "strict"`.
   */
  sandboxPermission?: SandboxPermission;
  /**
   * Generic harness-rendered files to materialize in the cwd before the session starts. Each
   * `{ path (relative to cwd), content }` was produced by the Python harness adapter (e.g. the
   * claude adapter renders `.claude/settings.json` from its permissions slice). `prepareWorkspace`
   * writes each entry blind — no harness knowledge on the runner.
   */
  harnessFiles?: Array<{ path: string; content: string }>;
}

export type BuildRunPlanResult =
  { ok: true; plan: RunPlan } | { ok: false; error: string };

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

const PI_DEFAULT_ACTIVE_BUILTINS = ["read", "bash", "edit", "write"];
const PI_BUILTIN_TOOL_NAMES = Object.keys(PI_BUILTIN_TOOL_IDENTITY);
const PI_BUILTIN_TOOL_NAME_SET = new Set<string>(PI_BUILTIN_TOOL_NAMES);

function normalizePiBuiltinGrants(tools: string[] | undefined): string[] {
  if (tools === undefined) return [...PI_DEFAULT_ACTIVE_BUILTINS];
  if (!Array.isArray(tools)) return [];
  const grants: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (typeof tool !== "string") continue;
    const name = tool.trim().toLowerCase();
    if (!PI_BUILTIN_TOOL_NAME_SET.has(name) || seen.has(name)) continue;
    seen.add(name);
    grants.push(name);
  }
  return grants;
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function permissionPlanCouldGatePiBuiltin(plan: PermissionPlan): boolean {
  if (plan.default !== "allow") return true;
  return plan.rules.some((rule) =>
    permissionRuleTargetsPiBuiltin(rule.pattern),
  );
}

function permissionRuleTargetsPiBuiltin(pattern: string): boolean {
  const open = pattern.indexOf("(");
  const toolName = open === -1 ? pattern : pattern.slice(0, open);
  return piBuiltinIdentity(toolName) !== undefined;
}

function computeBuiltinGatingActive(
  isPi: boolean,
  permissionPlan: PermissionPlan,
  builtinGrants: readonly string[],
): boolean {
  if (!isPi) return false;
  try {
    return (
      permissionPlanCouldGatePiBuiltin(permissionPlan) ||
      !sameStringSet(builtinGrants, PI_DEFAULT_ACTIVE_BUILTINS)
    );
  } catch {
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

  // The harness identity maps to a real ACP agent the daemon knows (`pi` / `claude`).
  // `pi_core` (plain Pi) and `pi_agenta` (Pi with Agenta's forced skills/prompt/policy) both
  // run on the `pi` ACP agent; `claude` runs on the `claude` ACP agent. `harness` remains the
  // selected identity for logs, traces, and user-facing errors.
  const acpAgent =
    harness === "pi_core" || harness === "pi_agenta" ? "pi" : harness;

  // Debug assertion: every Pi identity must resolve to the `pi` ACP agent and nothing else may.
  // Catches a future harness-id typo (e.g. a new `pi_*` value forgotten here) at plan-build time
  // rather than as a daemon "unknown agent" error mid-run.
  assert(
    (harness === "pi_core" || harness === "pi_agenta") === (acpAgent === "pi"),
    `harness '${harness}' resolved to ACP agent '${acpAgent}', but pi identity mapping disagrees`,
  );

  const prompt = resolvePromptText(request);
  if (!prompt) {
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

  // Subscription (runtime_provided) auth is a LOCAL-only capability: the harness reads and refreshes
  // its login on a read-write mount that lives in the runner container and is never shipped to a
  // third-party sandbox. Reject Daytona + runtime_provided here, before any sandbox is created,
  // rather than silently falling back to an unauthenticated remote run (interface.md sections 5-6).
  if (isDaytona && request.credentialMode === "runtime_provided") {
    return { ok: false, error: DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE };
  }

  // A local runtime_provided run authenticates from an explicitly mounted subscription. If the
  // harness config var is unset there is no mount to read, so fail up front with an actionable
  // message rather than letting the harness fall back to discovering the runner's own home dir
  // (interface.md section 6). Managed ("env") / "none" runs are unaffected.
  if (!isDaytona && request.credentialMode === "runtime_provided") {
    const subscriptionEnvVar =
      acpAgent === "claude" ? "CLAUDE_CONFIG_DIR" : "PI_CODING_AGENT_DIR";
    if (!process.env[subscriptionEnvVar]) {
      return { ok: false, error: LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE };
    }
  }

  const secrets = request.secrets ?? {};
  const legacyHarnessApiKeyVar =
    acpAgent === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const toolSpecs = (request.customTools as ResolvedToolSpec[]) ?? [];
  const executableToolSpecsForRun = executableToolSpecs(toolSpecs);
  const permissionPlan = permissionsFromRequest(request);
  const builtinGrants = normalizePiBuiltinGrants(request.tools);
  const builtinGatingActive = computeBuiltinGatingActive(
    isPi,
    permissionPlan,
    builtinGrants,
  );

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

  // Pi delivers tools through its bundled extension, not over ACP MCP, so a user MCP server on
  // a Pi run is DROPPED by `buildSessionMcpServers` (it returns [] for Pi). Dropping it silently
  // (no log, HTTP 200) is the F-032 silent-drop bug. Refuse any external user MCP server
  // on Pi up front with a Pi-specific message.
  if (isPi && (request.mcpServers?.length ?? 0) > 0) {
    return { ok: false, error: PI_USER_MCP_UNSUPPORTED_MESSAGE };
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

  // Non-Pi + remote + tools: executable (gateway/callback) tools are DELIVERABLE on Daytona
  // via the in-sandbox stdio MCP shim (uploaded per run, advertised as the internal typeless
  // stdio entry, calls relayed to the runner through the file relay). A remote provider that is
  // not Daytona fails CLOSED because the shim's upload + spawn path is proven for Daytona only.
  // Client tools are intentionally omitted from the Daytona shim's uploaded public specs: its
  // blocking relay call cannot pause for a browser round-trip yet. Local Claude and Pi retain
  // their existing client-tool delivery paths.
  if (!isPi && isRemoteSandbox && toolSpecs.length > 0) {
    if (!isDaytona) {
      return { ok: false, error: REMOTE_TOOLS_UNSUPPORTED_MESSAGE };
    }
    // On Daytona the shim advertises only executable tools; client tools are omitted. If the run
    // carries tools but NONE are executable, nothing would be delivered — refuse instead of
    // silently advertising an empty tool set (the F1 zero-tools drop mcp.ts's log warns about).
    if (executableToolSpecsForRun.length === 0) {
      return { ok: false, error: DAYTONA_CLIENT_ONLY_TOOLS_UNSUPPORTED_MESSAGE };
    }
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
  const { skills: skillDirs, cleanup: skillsCleanup } = resolveSkillDirs(
    request.skills,
    log,
  );
  if (skillDirs.length > 0)
    log(`skills: ${skillDirs.map((s) => s.name).join(", ")}`);

  const systemPrompt = isPi
    ? request.systemPrompt?.trim() || undefined
    : undefined;
  const appendSystemPrompt = isPi
    ? request.appendSystemPrompt?.trim() || undefined
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
      prompt,
      turnText: buildTurnText(request, log),
      agentsMd: request.agentsMd?.trim() || undefined,
      secrets,
      legacyHarnessApiKeyVar,
      hasApiKey: !!secrets[legacyHarnessApiKeyVar],
      credentialMode: request.credentialMode,
      cwd,
      relayDir,
      toolMcpDir,
      // Usage capture is ephemeral runner output, not durable session data — keep it off the
      // geesefs mount alongside the relay dir (a mount write would risk ENOTCONN).
      usageOutPath: isPi ? join(relayDir, ".agenta-usage.json") : undefined,
      toolSpecs,
      executableToolSpecs: executableToolSpecsForRun,
      builtinGrants,
      builtinGatingActive,
      // The relay carries tool EXECUTION only (permission gates ride the extension's
      // `ctx.ui.confirm` dialog onto the ACP plane), so a builtin-gating-only run needs no relay.
      useToolRelay: toolSpecs.length > 0,
      systemPrompt,
      appendSystemPrompt,
      hasSystemPrompt: !!(systemPrompt || appendSystemPrompt),
      skillDirs,
      skillsCleanup,
      sourcePiAgentDir:
        process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
      sandboxPermission: request.sandboxPermission,
      // Generic: the Python harness adapter already rendered any harness config files; the runner
      // just carries them onto the plan and writes them into the cwd in `prepareWorkspace`.
      harnessFiles: request.harnessFiles,
    },
  };
}
