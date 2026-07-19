/**
 * The `/run` wire contract.
 *
 * The Python side mirrors these names in `sdks/python/agenta/sdk/agents/utils/wire.py`.
 * The contract is pinned by shared golden fixtures under
 * `sdks/python/oss/tests/pytest/unit/agents/golden/`; a change here that drifts from those
 * fixtures fails `test_wire_contract.py`. The runner drives one engine (`sandbox_agent.ts`),
 * which runs the harness selected by `harness` (Pi or Claude) over ACP.
 */

/** One piece of a message. `text` is all the playground sends today; the rest is plumbed. */
export interface ContentBlock {
  type: "text" | "image" | "resource" | "tool_call" | "tool_result" | string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  // Tool-turn carriers, used for structured-message continuation (cross-turn HITL): a
  // resolved tool call replays as a `tool_call` block plus a `tool_result` block so the
  // model resumes from the result instead of re-asking. The `/messages` egress folds the
  // inbound UIMessage tool/approval parts into these (it must not drop them).
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface ChatMessage {
  role: string;
  /** A plain string, or ACP-style content blocks (text/image/resource). */
  content: string | ContentBlock[];
}

/**
 * W3C trace-context propagation threaded in from the Agenta service so the agent run joins the
 * caller's /invoke trace instead of starting its own. `traceparent` / `baggage` are the standard
 * W3C propagation headers, kept verbatim. This is per-call protocol CONTEXT (it changes every
 * turn) — distinct from the operator-owned `telemetry` config (where spans export, what is
 * captured) and from `runContext` (the run's own resource identity, bound into tool requests).
 * All fields optional; with none set the run is traced standalone (or not at all) using env config.
 */
export interface Propagation {
  traceparent?: string;
  baggage?: string;
}

export interface RequestContext {
  propagation?: Propagation;
}

/**
 * How this run's telemetry behaves: where spans are exported and what may be captured. This is
 * operator/policy-owned CONFIG, distinct from the per-call propagation `context` above.
 *
 *  - `capture.content.enabled` is the capture POLICY: default on; `false` strips message and tool
 *    content from the exported spans.
 *  - `exporters.otlp` is the OTLP destination: `endpoint` is the traces URL, and `headers` carries
 *    the exporter CREDENTIAL under the standard `authorization` header (kept verbatim), so the
 *    secret lives under the thing it authenticates rather than as a free-floating field.
 *
 * All fields optional; an absent endpoint/headers falls back to the runner's env config.
 */
export interface OtlpExporter {
  endpoint?: string;
  headers?: Record<string, string>;
}

export interface Telemetry {
  capture?: { content?: { enabled?: boolean } };
  exporters?: { otlp?: OtlpExporter };
}

/** The global permission policy modes. `allow_reads`: read-hinted tools run, everything else asks. */
export type PermissionMode = "allow" | "ask" | "deny" | "allow_reads";
/** A single tool's permission verdict vocabulary. */
export type ToolPermission = "allow" | "ask" | "deny";
/** An authored harness-builtin rule, Claude settings syntax (e.g. "Bash(rm:*)"). */
export interface PermissionRule {
  pattern: string;
  permission: ToolPermission;
}
export interface PermissionsConfig {
  default?: PermissionMode;
  rules?: PermissionRule[];
}

/**
 * A runnable tool the backend already resolved from the agent config.
 *
 * Two orthogonal axes:
 *  - `kind` (executor): how the runner fulfils a call. `callback` POSTs back through Agenta's
 *    /tools/call (gateway tools; the Composio key stays server-side); `code` runs `code` in a
 *    sandbox subprocess with `env` (resolved secrets, scoped to the subprocess); `client` is
 *    fulfilled by the browser across a turn boundary. Absent = `callback` (back-compat).
 *  - `render`: a generative-UI hint (see `RenderHint`).
 *
 * `callRef` is set for `callback` (gateway) tools (the slug the bridge sends back to
 * /tools/call); `call` is set for direct-call callback tools (reference / platform), which the
 * runner calls directly instead of routing through /tools/call. A callback spec carries `call`
 * XOR `callRef`. `runtime`/`code`/`env` for `code` tools. The Composio key and connection auth
 * stay server-side.
 */
export interface ResolvedToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown> | null;
  /** Set for gateway `callback` tools (routes through /tools/call); absent for `code` / `client`, and absent when `call` is set. */
  callRef?: string;
  /**
   * Executor-private argument bindings for `callRef` tools. The runner fills each dotted argument
   * path from `runContext` after the permission verdict and before posting to `/tools/call`, so
   * the model cannot override the bound fields. Not advertised to the model.
   */
  contextBindings?: Record<string, string>;
  /** Optional per-tool execution budget for the `/tools/call` round-trip and child relay wait. */
  timeoutMs?: number;
  /**
   * Direct-call descriptor (direct-call tools, Phase 1). When set, the runner calls this Agenta
   * endpoint DIRECTLY (reusing the run's `toolCallback.authorization`) instead of routing through
   * `/tools/call`. `path` is an absolute path from the Agenta origin (the runner derives the
   * origin from `toolCallback.endpoint`, so a tool can never reach a non-Agenta host); `body` are
   * static server-fixed fields baked at resolve time; `context` maps a dotted body path to a
   * `"$ctx.<key>"` token the runner fills from the run context at dispatch; `args_into` is the
   * dotted path where the model's arguments are placed (absent = the body root). A spec carries
   * `call` XOR `callRef`. Plumbing only here: nothing emits or dispatches it yet.
   */
  call?: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
    context?: Record<string, string>;
    args_into?: string;
  };
  kind?: "callback" | "code" | "client";
  render?: RenderHint;
  /** MCP behavioral hint: true (read-only), false (mutating), absent (unknown). */
  readOnly?: boolean;
  /**
   * Layer-3 permission: `allow` runs with no prompt, `ask` raises a
   * human-in-the-loop request, `deny` never runs. Absent = fall back to the global
   * permission plan. The SDK derives a default from `readOnly` when the author set none.
   */
  permission?: ToolPermission;
}

/** Where and how to route a tool call back through Agenta. */
export interface ToolCallbackContext {
  endpoint: string;
  authorization?: string;
}

/** One workflow entity inside `RunContext.workflow`: the platform's `{id, slug, version}`
 * reference shape (the API's `Reference`). `version` is meaningful only on the revision. */
export interface RunContextReference {
  id?: string;
  slug?: string;
  version?: string;
}

/**
 * The run's own context, delivered on `/run` and refreshed per turn (direct-call tools, Phase 3a;
 * see `projects/direct-call-tools/run-context.md`). The service computes it from the invocation's
 * own trace + workflow identity. It is consumed by tool context bindings: `call.context` on
 * direct-call specs and `contextBindings` on callRef specs. The runner fills bound request fields
 * from this blob at dispatch, server-side and hidden from the model. The model never reads run
 * context directly.
 *
 * `workflow` mirrors the platform's three workflow entities — the `artifact` (the workflow), the
 * `variant`, and the `revision` — so the run's identity reads the same way the rest of the platform
 * names a workflow; `is_draft` says whether the run targets a committed revision (`false`) or an
 * uncommitted playground draft (`true`). The conversation id is NOT carried here — it rides the
 * top-level `sessionId` field, and the runner owns the live id across turns.
 *
 * The inner keys are deliberately snake_case (`workflow.variant.id`, `trace.trace_id`): they are
 * the binding NAMESPACE a `call.context` value (`"$ctx.<dotted.path>"`) addresses, so they match
 * those tokens exactly rather than the rest of the wire's camelCase. Every field is optional and
 * best-effort — the service fills what it holds and omits the rest.
 */
export interface RunContext {
  run?: {
    kind?: string;
  };
  /**
   * The run's owning project id, stamped by the service from its own request state (the OTel
   * baggage), never from the request body. The id textually arrives on the caller's baggage
   * header; it is trustworthy because the service's auth middleware denies any request whose
   * credential is not authorized for that project id, so a forged id cannot cross tenants
   * (that auth check backstops this field — do not weaken it). The runner prefers `project.id`
   * over the mount-derived project scope when keying its parked-session pool (`poolKeyFor`).
   */
  project?: {
    id?: string;
  };
  workflow?: {
    artifact?: RunContextReference;
    variant?: RunContextReference;
    revision?: RunContextReference;
    is_draft?: boolean;
  };
  trace?: {
    trace_id?: string;
    span_id?: string;
  };
}

/**
 * One bundled file laid beside SKILL.md by relative `path`. `content` is inline UTF-8 text;
 * `executable` requests a `chmod +x` that the runner honors only when the skill's
 * `allowExecutableFiles` is set AND the sandbox/harness policy allows execution (default deny).
 * `content` is untrusted author code.
 */
export interface WireSkillFile {
  path: string;
  content: string;
  executable?: boolean;
}

/**
 * A resolved inline skill package. By the time a skill reaches the runner every reference has
 * been inlined server-side (via `@ag.embed`), so there is one shape: the SKILL.md frontmatter
 * fields (`name`/`description`), the Markdown `body`, and optional bundled `files`. The runner
 * materializes this into a skill dir at run time (see `engines/skills.ts`). There is no
 * name-against-a-bundled-root resolution anymore.
 */
export interface WireSkill {
  name: string;
  description: string;
  body: string;
  files?: WireSkillFile[];
  /** Pi/Claude: hide from the prompt, invoke only via `/skill:name`. */
  disableModelInvocation?: boolean;
  /** Gate the `chmod +x` of executable bundled files (default deny; policy must also allow). */
  allowExecutableFiles?: boolean;
}

export interface McpToolPolicy {
  mode: "all" | "include";
  names?: string[];
}

export interface McpServerConfig {
  name: string;
  connection: {
    type: "http";
    url: string;
    /** Resolved per-run headers. Values may be secret and must never be logged. */
    headers?: Record<string, string>;
  };
  policy: {
    tools: McpToolPolicy;
    permission?: ToolPermission;
  };
}

/**
 * The sandbox security boundary an agent runs inside (Layer 2). `network` is the outbound
 * egress policy (`on` = allow all, `off` = block all, `allowlist` = only `network.allowlist`
 * CIDR ranges); `filesystem` is declared but not enforced yet; `enforcement` is `strict`
 * (fail when the boundary cannot be applied) or `best_effort`. The network policy IS enforced
 * on Daytona (`provider.ts` `daytonaNetworkFields`); on the local sidecar it cannot be a hard
 * guarantee, so a restricted-network run there is rejected under `strict` (`run-plan.ts`).
 * `filesystem` is declared-only on every provider.
 */
export interface SandboxPermission {
  network?: {
    mode?: "on" | "off" | "allowlist";
    /** CIDR ranges; honored when `mode === "allowlist"`. */
    allowlist?: string[];
  };
  /** Declared, NOT enforced today. */
  filesystem?: "on" | "readonly" | "off";
  /** Omitted defaults to `strict` (matches the wire schema); only `best_effort` opts out. */
  enforcement?: "strict" | "best_effort";
}

/**
 * What a harness can do, probed from the runtime (sandbox-agent `AgentCapabilities`). The runner
 * branches on these flags instead of the harness name, and returns them in the result.
 */
export interface HarnessCapabilities {
  textMessages?: boolean;
  images?: boolean;
  fileAttachments?: boolean;
  mcpTools?: boolean;
  toolCalls?: boolean;
  reasoning?: boolean;
  planMode?: boolean;
  permissions?: boolean;
  usage?: boolean;
  streamingDeltas?: boolean;
  sessionLifecycle?: boolean;
}

/**
 * One structured run event. Mirrors the ACP `session/update` variants we surface.
 *
 * Two text families coexist. The coalesced `message` / `thought` events carry the whole
 * block and are what the one-shot `/run` result log holds (the non-streaming path has no
 * per-token granularity to recover). The `*_start` / `*_delta` / `*_end` lifecycle events
 * are emitted live on the streaming path; a consumer that sees the delta family for a block
 * never also sees a coalesced `message` for it (see `createSandboxAgentOtel.finish`).
 */
/**
 * A generative-UI hint stamped onto a tool's events so the frontend can render it. The
 * tool-definition plan adds the matching `render?` field to `ResolvedToolSpec`; the runner
 * copies it onto `tool_call` / `tool_result` so the egress can project it without a spec
 * lookup. `component` is a prebuilt client component (no code execution); `source` ships
 * code rendered in a sandbox; `spec` is a declarative UI tree (data, not code).
 */
export type RenderHint =
  | { kind: "component"; component: string }
  | { kind: "source"; runtime: "react" | "html"; source: string | string[] }
  | { kind: "spec"; schema: string }
  // `connect` requests the built-in connect widget: a `client` tool (e.g. `request_connection`)
  // stamps it so the frontend renders the OAuth/API-key connect dialog when the tool pauses. No
  // payload — the widget is fully described by the paused call's tool name + input. `wire.py` does
  // not pin RenderHint (render rides as an opaque dict), so this member is TS-only.
  | { kind: "connect" }
  // `elicitation` requests the built-in schema-driven form (interaction kinds M1): the `request_input`
  // client tool stamps it so the frontend renders a form from the paused call's `requestedSchema`. Like
  // `connect`, it carries no payload here and is TS-only (the render rides through as an opaque dict).
  | { kind: "elicitation" };

export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "thought"; text: string }
  | { type: "message_start"; id: string }
  | { type: "message_delta"; id: string; delta: string }
  | { type: "message_end"; id: string }
  | { type: "thought_start"; id: string }
  | { type: "thought_delta"; id: string; delta: string }
  | { type: "thought_end"; id: string }
  | {
      type: "tool_call";
      id?: string;
      name?: string;
      input?: unknown;
      render?: RenderHint;
    }
  | {
      type: "tool_result";
      id?: string;
      output?: string;
      /** Structured output (object), used for generative UI; `output` stays the text form. */
      data?: unknown;
      isError?: boolean;
      /**
       * The result is a USER/POLICY DENIAL of a gated call, not a genuine tool failure. A denied
       * call still rides `isError: true` (the harness closes it as a failed tool call), so this
       * structural marker is the only reliable way for the egress to project `tool-output-denied`
       * (a decline) instead of `tool-output-error` (a breakage). Set by the runner at the deny
       * mapping, never inferred from the error text.
       */
      denied?: boolean;
      render?: RenderHint;
    }
  // A human-in-the-loop request the harness raised (ACP reverse-RPC). The kind is our own
  // interactions vocabulary; each adapter maps it to its wire (the Vercel egress projects
  // user_approval -> `tool-approval-request`, user_input -> an input/data part). The reply
  // returns cross-turn in the next `/messages` message history, matched by `id`.
  | {
      type: "interaction_request";
      id: string;
      kind: "user_approval" | "user_input" | "client_tool";
      payload?: unknown;
    }
  // One-way generative-UI payloads (not tied to a tool result). `data` -> Vercel `data-<name>`,
  // `file` -> Vercel `file`.
  | { type: "data"; name: string; data: unknown; transient?: boolean }
  | { type: "file"; url: string; mediaType: string }
  | {
      type: "usage";
      input?: number;
      output?: number;
      total?: number;
      cost?: number;
    }
  | { type: "error"; message: string }
  // `traceId` is the run's observability trace id, stamped on the turn's terminal event so a
  // persisted transcript can link a replayed turn back to its trace (latency, full-trace view).
  // Live streams carry it via `messageMetadata`; this is the durable-replay channel.
  | { type: "done"; stopReason?: string; traceId?: string };

/** A live event sink the engines call as each event is built. */
export type EmitEvent = (event: AgentEvent) => void;

/** Run token/cost totals, rolled up onto the caller's workflow span. */
export interface AgentUsage {
  input: number;
  output: number;
  total: number;
  cost: number;
}

export interface AgentRunRequest {
  /**
   * Harness id: "pi_core" | "pi_agenta" | "claude". `pi_core` and `pi_agenta` both drive the
   * ACP agent "pi" (pi_agenta is Pi with Agenta's forced skills/prompt/policy); "claude" drives
   * the ACP agent "claude". Selected by the request; there is no engine selector.
   */
  harness?: string;
  /** Sandbox: "local" | "daytona". */
  sandbox?: string;
  /** External conversation id. The cold runtime still receives history in `messages`. */
  sessionId?: string;
  /** Provider API keys as env vars ({OPENAI_API_KEY,...}), resolved from the vault. */
  secrets?: Record<string, string>;
  /** AGENTS.md text injected as the agent's instructions. */
  agentsMd?: string;
  /**
   * Pi only: replace Pi's built-in base system prompt outright (Pi's `systemPrompt` /
   * `SYSTEM.md`). AGENTS.md is still appended after it, so this changes Pi's persona, not
   * the project context. Leave unset to keep Pi's default coding-assistant prompt.
   */
  systemPrompt?: string;
  /**
   * Pi only: append to the base system prompt without replacing it (Pi's
   * `appendSystemPrompt` / `APPEND_SYSTEM.md`). Use this to add framing on top of Pi's
   * default prompt rather than rewrite it.
   */
  appendSystemPrompt?: string;
  /** Model id ("gpt-5.5") or "provider/id" ("openai-codex/gpt-5.5"). */
  model?: string;
  /**
   * Provider family for the run, e.g. "openai" | "anthropic" | <custom-slug>. Non-secret.
   * Present only when the config carries a structured model ref. See the provider-model-auth
   * design (Concern 1).
   */
  provider?: string;
  /**
   * Where the credential comes from, named portably (a slug, never a db id). Non-secret.
   * Present only when the config carries a structured model ref. See the provider-model-auth
   * design (Concern 1).
   */
  connection?: { mode: string; slug?: string };
  /**
   * Deployment surface for the provider: "direct" | "azure" | "bedrock" | "vertex" |
   * "custom". From a resolved connection; see the provider-model-auth design (Concern 3).
   */
  deployment?: string;
  /**
   * Non-secret connection config (custom base URL, api version, region, public headers).
   * Secret values never live here; they ride `secrets`. See the provider-model-auth design
   * (Concern 3).
   */
  endpoint?: {
    baseUrl?: string;
    apiVersion?: string;
    region?: string;
    headers?: Record<string, string>;
  };
  /**
   * How the credential is delivered: "env" | "runtime_provided" | "none". From a resolved
   * connection; see the provider-model-auth design (Concern 3).
   */
  credentialMode?: string;
  /** The conversation so far; the runner picks the latest turn and replays the rest. */
  messages?: ChatMessage[];
  /** Built-in tools to enable. */
  tools?: string[];
  /**
   * Resolved inline skill packages. Each rode the wire as concrete content (references
   * inlined server-side via `@ag.embed`); the runner materializes each into a skill dir and
   * loads it into Pi's resource loader, so it appears in the system prompt (Pi only renders
   * skills when the `read` tool is enabled).
   */
  skills?: WireSkill[];
  /** Resolved runnable tools (WP-7). */
  customTools?: ResolvedToolSpec[];
  /** User-declared MCP servers, resolved (secret env injected). Omitted when there are none. */
  mcpServers?: McpServerConfig[];
  /** Where customTools route their calls back to. Required when customTools is set. */
  toolCallback?: ToolCallbackContext;
  /** Authored permission plan assembled by the SDK (`runner.permissions.*` in the agent config). */
  permissions?: PermissionsConfig;
  /**
   * The declared sandbox security boundary (Layer 2). Omitted when unset. The network policy is
   * enforced on Daytona; on the local sidecar a restricted-network run is rejected under
   * `strict` (it cannot be a hard guarantee there). `filesystem` is declared-only.
   */
  sandboxPermission?: SandboxPermission;
  /**
   * Generic harness-rendered files to drop in the session cwd before the session starts. Each
   * entry is `{ path (relative to cwd), content (UTF-8 file text) }`. Produced by the Python
   * harness adapters: a harness translates its own `harness_options` slice into a config file in
   * Python (e.g. the claude adapter renders `.claude/settings.json` from its permissions slice),
   * so the runner stays a dumb writer with no harness knowledge. Omitted when no files were
   * rendered. This scales to many harnesses: a new harness emits its files here instead of a
   * first-party wire field plus runner-side translation.
   */
  harnessFiles?: Array<{ path: string; content: string }>;
  /**
   * W3C trace-context propagation: nests the run under the caller's /invoke span so the agent's
   * work joins the same trace (see `service-and-runner-trace-export.md`). Per-call context; the
   * run's own resource identity rides `runContext`, and the exporter config rides `telemetry`.
   */
  context?: RequestContext;
  /**
   * Telemetry config: where this run's spans export (`exporters.otlp`) and the content-capture
   * policy (`capture.content.enabled`). Operator/policy-owned; falls back to the runner's env.
   */
  telemetry?: Telemetry;
  /**
   * The run's own context (trace + variant identity), refreshed per turn (direct-call tools,
   * Phase 3a). Consumed only by a tool's `call.context` binding at dispatch — the runner fills the
   * bound request fields from this blob server-side, hidden from the model (see `RunContext` and
   * `tools/direct.ts` `assembleBody`). Omitted when the run has no own identity to bind.
   */
  runContext?: RunContext;
  /**
   * The turn's coordination plane id (one execution of the agent loop). Set on session-owned
   * detached runs so the runner can prove alive-lock ownership on heartbeat. Absent for
   * non-session runs. A session sees a sequence of turnIds (send/steer each start a new one).
   */
  turnId?: string;
  /**
   * The Agenta project id for this run. Set alongside `turnId` on session-owned runs so
   * the runner can include it in heartbeat and record-ingest calls. Absent otherwise.
   */
  projectId?: string;
}

export interface AgentRunResult {
  ok: boolean;
  /** Final assistant text (what the playground renders). */
  output?: string;
  /** Structured assistant messages for the turn. */
  messages?: ChatMessage[];
  /** Structured event log for the turn. */
  events?: AgentEvent[];
  /** Run token/cost totals, for roll-up onto the caller's workflow span. */
  usage?: AgentUsage;
  /** Why the turn ended (harness-reported when available). */
  stopReason?: string;
  /** What the harness was probed to support this run. */
  capabilities?: HarnessCapabilities;
  sessionId?: string;
  model?: string;
  /** Trace id of the run (the caller's trace when a traceparent was passed). */
  traceId?: string;
  error?: string;
}

/**
 * One line of the NDJSON stream the runner writes when a caller asks for live delivery
 * (HTTP `Accept: application/x-ndjson`, or the CLI `--stream` flag). Every `event` record
 * flushes the moment its `AgentEvent` is built; the run ends with exactly one `result`
 * record carrying the same `AgentRunResult` the one-shot path returns (so the Python side
 * parses it with the same `result_from_wire`). On the streaming path the terminal result's
 * `events` is empty — the events were already delivered live.
 */
export type StreamRecord =
  | { kind: "event"; event: AgentEvent }
  | { kind: "result"; result: AgentRunResult };

/** Flatten a message's content (string or content blocks) to its text. */
export function messageText(
  content: string | ContentBlock[] | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

/** The latest user turn: the last user message's text (the wire carries no standalone prompt). */
export function resolvePromptText(request: AgentRunRequest): string {
  const messages = request.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const text = messageText(messages[i].content);
      if (text) return text;
    }
  }
  return "";
}

/** Prefer the platform conversation id, falling back to the harness's ephemeral id. */
export function resolveRunSessionId(
  request: AgentRunRequest,
  fallback: string,
): string {
  return request.sessionId && request.sessionId.trim()
    ? request.sessionId
    : fallback;
}
