/**
 * The `/run` wire contract, shared by both backends.
 *
 * The Python side mirrors these names in `sdks/python/agenta/sdk/agents/utils/wire.py`.
 * The contract is pinned by shared golden fixtures under
 * `sdks/python/oss/tests/pytest/unit/agents/golden/`; a change here that drifts from those
 * fixtures fails `test_wire_contract.py`. Keeping the request/result/event/capability types
 * here (rather than in one runner that the other imports from) is what lets `engines/pi.ts`
 * and `engines/sandbox_agent.ts` stay peers.
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
 * Trace context threaded in from the Agenta service so the agent run joins the caller's
 * /invoke trace instead of starting its own. All fields optional; with none set the run is
 * traced standalone (or not at all) using env config.
 */
export interface TraceContext {
  traceparent?: string;
  baggage?: string;
  endpoint?: string;
  authorization?: string;
  captureContent?: boolean;
}

/**
 * A runnable tool the backend already resolved from the agent config.
 *
 * Three orthogonal axes:
 *  - `kind` (executor): how the runner fulfils a call. `callback` POSTs back through Agenta's
 *    /tools/call (gateway tools; the Composio key stays server-side); `code` runs `code` in a
 *    sandbox subprocess with `env` (resolved secrets, scoped to the subprocess); `client` is
 *    fulfilled by the browser across a turn boundary. Absent = `callback` (back-compat).
 *  - `needsApproval`: gate the call on a human yes/no (mechanics owned by the run-event layer).
 *  - `render`: a generative-UI hint (see `RenderHint`).
 *
 * `callRef` is set for `callback` tools (the slug the bridge sends back to /tools/call);
 * `runtime`/`code`/`env` for `code` tools. The Composio key and connection auth stay
 * server-side.
 */
export interface ResolvedToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown> | null;
  /** Set for `callback` (gateway) tools only; absent for `code` / `client`. */
  callRef?: string;
  kind?: "callback" | "code" | "client";
  runtime?: "python" | "node";
  code?: string;
  env?: Record<string, string>;
  needsApproval?: boolean;
  render?: RenderHint;
}

/** Where and how to route a tool call back through Agenta. */
export interface ToolCallbackContext {
  endpoint: string;
  authorization?: string;
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

/**
 * A user-declared MCP server attached to the run. `stdio` launches `command`/`args` with
 * `env` (secret env already resolved server-side); `tools` is an optional allowlist (empty =
 * all). Remote (`http`) carries no auth on the wire by design.
 */
export interface McpServerConfig {
  name: string;
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  tools?: string[];
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
  | { kind: "spec"; schema: string };

export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "thought"; text: string }
  | { type: "message_start"; id: string }
  | { type: "message_delta"; id: string; delta: string }
  | { type: "message_end"; id: string }
  | { type: "reasoning_start"; id: string }
  | { type: "reasoning_delta"; id: string; delta: string }
  | { type: "reasoning_end"; id: string }
  | { type: "tool_call"; id?: string; name?: string; input?: unknown; render?: RenderHint }
  | {
      type: "tool_result";
      id?: string;
      output?: string;
      /** Structured output (object), used for generative UI; `output` stays the text form. */
      data?: unknown;
      isError?: boolean;
      render?: RenderHint;
    }
  // A human-in-the-loop request the harness raised (ACP reverse-RPC). The egress projects
  // it to a Vercel `tool-approval-request` (permission) or an input/data part (elicitation);
  // the reply returns cross-turn in the next `/messages` message history, matched by `id`.
  | {
      type: "interaction_request";
      id: string;
      kind: "permission" | "input" | "client_tool";
      payload?: unknown;
    }
  // One-way generative-UI payloads (not tied to a tool result). `data` -> Vercel `data-<name>`,
  // `file` -> Vercel `file`.
  | { type: "data"; name: string; data: unknown; transient?: boolean }
  | { type: "file"; url: string; mediaType: string }
  | { type: "usage"; input?: number; output?: number; total?: number; cost?: number }
  | { type: "error"; message: string }
  | { type: "done"; stopReason?: string };

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
  /** Engine: "sandbox-agent" (ACP) or "pi" (legacy in-process). Routed on by cli.ts/server.ts. */
  backend?: string;
  /** Harness id for the sandbox-agent backend ("pi" / "claude"). */
  harness?: string;
  /** Sandbox for the sandbox-agent backend ("local" / "daytona"). */
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
  /** Explicit latest turn. Falls back to the last user message in `messages`. */
  prompt?: string;
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
  /** How a permission-gating harness handles tool-use prompts: "auto" (default) | "deny". */
  permissionPolicy?: string;
  /** Tracing: thread the Agenta trace context across the boundary. */
  trace?: TraceContext;
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
export function messageText(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

/** The latest user turn: explicit prompt, else last user message content. */
export function resolvePromptText(request: AgentRunRequest): string {
  if (request.prompt && request.prompt.trim()) return request.prompt;
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
export function resolveRunSessionId(request: AgentRunRequest, fallback: string): string {
  return request.sessionId && request.sessionId.trim() ? request.sessionId : fallback;
}
