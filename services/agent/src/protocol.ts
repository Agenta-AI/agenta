/**
 * The `/run` wire contract, shared by both backends.
 *
 * The Python side mirrors these names in `services/oss/src/harness/wire.py`. Keeping the
 * request/result/event/capability types here (rather than in one runner that the other
 * imports from) is what lets `runPi.ts` and `runRivet.ts` stay peers.
 */

/** One piece of a message. `text` is all the playground sends today; the rest is plumbed. */
export interface ContentBlock {
  type: "text" | "image" | "resource" | string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
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
 * A runnable tool the backend already resolved from the agent config: name + description +
 * JSON-Schema params for the model, plus the `callRef` slug the execution bridge sends back
 * to Agenta's /tools/call. The Composio key and connection auth stay server-side.
 */
export interface ResolvedToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown> | null;
  callRef: string;
}

/** Where and how to route a tool call back through Agenta. */
export interface ToolCallbackContext {
  endpoint: string;
  authorization?: string;
}

/**
 * What a harness can do, probed from the runtime (rivet `AgentCapabilities`). The runner
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

/** One structured run event. Mirrors the ACP `session/update` variants we surface. */
export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; id?: string; output?: string; isError?: boolean }
  | { type: "usage"; input?: number; output?: number; total?: number; cost?: number }
  | { type: "error"; message: string }
  | { type: "done"; stopReason?: string };

/** Run token/cost totals, rolled up onto the caller's workflow span. */
export interface AgentUsage {
  input: number;
  output: number;
  total: number;
  cost: number;
}

export interface AgentRunRequest {
  /** Engine: "rivet" (ACP) or "pi" (legacy in-process). Routed on by cli.ts/server.ts. */
  backend?: string;
  /** Harness id for the rivet backend ("pi" / "claude"). */
  harness?: string;
  /** Sandbox for the rivet backend ("local" / "daytona"). */
  sandbox?: string;
  /** Continue a prior run by replaying its history. */
  sessionId?: string;
  /** Provider API keys as env vars ({OPENAI_API_KEY,...}), resolved from the vault. */
  secrets?: Record<string, string>;
  /** AGENTS.md text injected as the agent's instructions. */
  agentsMd?: string;
  /** Model id ("gpt-5.5") or "provider/id" ("openai-codex/gpt-5.5"). */
  model?: string;
  /** Explicit latest turn. Falls back to the last user message in `messages`. */
  prompt?: string;
  /** The conversation so far; the runner picks the latest turn and replays the rest. */
  messages?: ChatMessage[];
  /** Built-in tools to enable. */
  tools?: string[];
  /** Resolved runnable tools (WP-7). */
  customTools?: ResolvedToolSpec[];
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
