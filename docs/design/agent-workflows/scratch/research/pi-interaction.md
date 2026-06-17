# Research: Programmatically driving the pi.dev agent harness

Status: research only. No code changed outside this file.
Scope: how the Agenta backend can drive a "pi.dev" harness for the new `agents`
workflow type. Answers questions 1-7 from the research brief, with sources.

## Summary

- **pi.dev is the Pi coding agent** by Earendil Inc.: "a minimal, extensible agent
  harness." It is a TypeScript/Node monorepo, MIT-licensed, distributed on npm.
  Latest published version at time of research: **0.79.4**. The CLI binary is `pi`.
- Three layers matter to us, smallest to largest:
  - `@earendil-works/pi-ai` - unified multi-provider LLM API (`getModel`, `stream`,
    `complete`, content blocks incl. images, image generation).
  - `@earendil-works/pi-agent-core` - the agent loop: stateful `Agent` class, tool
    calling, event stream, `sessionId`, before/after tool hooks, transport abstraction.
  - `@earendil-works/pi-coding-agent` - the full harness + CLI: `createAgentSession`,
    built-in tools (read/bash/edit/write/...), extensions/hooks, skills, AGENTS.md
    loading, session persistence (JSONL), and four run surfaces (TUI, print/JSON, RPC,
    SDK).
- **Four ways to drive it programmatically.** For a Python backend driving pi inside a
  sandbox, the realistic options are (a) **RPC mode** (`pi --mode rpc`, JSONL over
  stdin/stdout, bidirectional, supports follow-ups/steering/abort), or (b) **print/JSON
  mode** (`pi --mode json "prompt"`, one-shot, JSON-lines events on stdout). The
  **SDK** (`createAgentSession`) is the in-process TypeScript path and gives the richest
  control; it is what you would use if any part of the harness is itself Node.
- **Multi-message output, sessions, streaming, hooks, tools, model selection** are all
  first-class and map cleanly onto the design doc's requirements. The one soft spot is
  **"pi instruments"**: pi itself ships no built-in "instruments" product. The
  observability story is OpenTelemetry via the community `pi-otel` extension (built on
  pi's hooks), plus an in-house extensions/hooks API you can instrument against. See
  Question 3 and the Open questions section.
- **Swappable harness + local parity** are supported by design: the harness is the thing
  behind a thin run surface (RPC/JSON/SDK), so a different harness (e.g. OpenAI Codex)
  that speaks the same surface can be slotted in; and the same `pi` binary/SDK runs
  locally and in the sandbox, which is exactly the parity the design wants.

## What pi.dev is (with sources)

"Pi is a minimal, extensible agent harness... Adapt Pi to your workflows, not the other
way around." It deliberately omits things like sub-agents and plan mode so you compose
them yourself via extensions.
Source: https://pi.dev/ and https://github.com/earendil-works/pi

Packages (all MIT, all `0.79.4` at research time; confirmed via the npm registry API):
- `@earendil-works/pi-coding-agent` - "Coding agent CLI with read, bash, edit, write
  tools and session management." Bin: `{"pi": "dist/cli.js"}`. Depends on
  `pi-agent-core`, `pi-ai`, `pi-tui` (all `^0.79.4`), `typebox@1.x`, `undici`, etc.
- `@earendil-works/pi-agent-core` - "General-purpose agent with transport abstraction,
  state management, and attachment support."
- `@earendil-works/pi-ai` - "Unified LLM API with automatic model discovery and provider
  configuration."
Source: `https://registry.npmjs.org/@earendil-works/pi-coding-agent` (and `/pi-ai`,
`/pi-agent-core`), GitHub repo root README.

Repository layout (monorepo):
```
packages/
  coding-agent/   # CLI + harness (SDK lives here)
  agent/          # @earendil-works/pi-agent-core
  ai/             # @earendil-works/pi-ai
  tui/            # @earendil-works/pi-tui
```
Key docs in-repo: `packages/coding-agent/docs/{sdk,extensions,json,rpc,models,settings,
containerization}.md`.
Source: https://github.com/earendil-works/pi/tree/main/packages

Why this matches the design doc's "agent harness with tools, hooks, instruments,
sessions, runs in sandboxes": pi provides tools (built-in + custom via TypeBox),
25+ TypeScript hooks, JSONL sessions with a `sessionId`, a documented containerization
story, and a community OTel instrumentation extension. The name "pi.dev" in the design
doc is unambiguously this product.

Install (host or inside sandbox image):
```bash
npm install @earendil-works/pi-coding-agent   # SDK + CLI
# CLI is also installable via curl / PowerShell / pnpm / bun per pi.dev
```
Source: https://github.com/earendil-works/pi, https://pi.dev/

---

## Question 1 - How do you programmatically interact with pi.dev (API/SDK/CLI surface)?

**Language:** TypeScript/Node. There is no first-party Python SDK; a Python backend
drives pi over a process boundary (RPC or print/JSON mode) or shells out to the `pi` CLI.

**Four run surfaces** (pi's own term):
1. **Interactive TUI** - `pi` (not relevant to us).
2. **Print / JSON mode** - `pi -p "query"` or `pi --mode json "query"`. One-shot;
   emits results (text or JSON-lines events) to stdout. Good for stateless single runs.
3. **RPC mode** - `pi --mode rpc`. JSON protocol over stdin/stdout; bidirectional and
   long-lived. This is the canonical "drive it from another process/language" surface.
4. **SDK** - `import { createAgentSession } from "@earendil-works/pi-coding-agent"`.
   In-process, richest control. This is what you embed if your harness runner is Node.
Sources: https://pi.dev/, https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md

**SDK entrypoints** (from `docs/sdk.md`):
```typescript
import {
  createAgentSession,
  createAgentSessionRuntime,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  defineTool,
} from "@earendil-works/pi-coding-agent";

const { session, extensionsResult, modelFallbackMessage } =
  await createAgentSession({
    cwd: process.cwd(),
    model: myModel,
    thinkingLevel: "medium",
    tools: ["read", "bash", "edit"],
    sessionManager: SessionManager.inMemory(),
  });
```
`createAgentSessionRuntime(factory, options)` is the multi-session variant
(`newSession()`, `switchSession()`, `fork()`, `importFromJsonl()`).

The returned `AgentSession` interface (verbatim from docs):
```typescript
interface AgentSession {
  prompt(text: string, options?: PromptOptions): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  setModel(model: Model): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  cycleModel(): Promise<ModelCycleResult | undefined>;
  navigateTree(targetId: string, options?: NavigateOptions): Promise<NavigateResult>;
  compact(customInstructions?: string): Promise<CompactionResult>;
  abort(): Promise<void>;
  dispose(): void;
  sessionFile: string | undefined;
  sessionId: string;            // <-- session id, see Q7
  agent: Agent;
  model: Model | undefined;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];     // <-- multi-message output, see Q4
  isStreaming: boolean;
}
```
Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md

**Low-level loop** (in `pi-agent-core`) if you want to drive turns yourself:
```typescript
import { agentLoop, agentLoopContinue } from "@earendil-works/pi-agent-core";
for await (const event of agentLoop([userMessage], context, config)) { /* ... */ }
```
Source: https://github.com/earendil-works/pi/blob/main/packages/agent/README.md

**Recommendation for Agenta:** drive pi over **RPC mode** from the Python backend
process that owns the sandbox (long-lived, supports follow-ups/steering/abort and a
stable JSONL contract), and reserve print/JSON mode for stateless single-shot runs. Use
the SDK only if the in-sandbox runner is itself Node. RPC/JSON give the cleanest swappable
boundary for a non-pi harness (Codex) later (Question 7).

---

## Question 2 - Sending messages and getting responses; streaming

**SDK:** `await session.prompt(text, options?)` sends a user message and resolves when the
agent turn completes. Mid-stream you can `steer()` (replace current op) or `followUp()`
(queue after the turn). Streaming is via `subscribe()` callbacks (push-based observer,
not an async generator at the session level):
```typescript
const unsubscribe = session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);   // streaming text
      }
      break;
    case "tool_execution_start": /* event.toolName */ break;
    case "tool_execution_end":   /* event.isError */ break;
    case "turn_end":  /* event.message */ break;
    case "agent_end": /* event.messages = full multi-message output */ break;
  }
});
```
Full event set: `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`,
`message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`,
`tool_execution_end`, `queue_update`, `compaction_start/end`, `auto_retry_start/end`.
Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md

**pi-agent-core** is where the async-generator streaming lives: `agentLoop()` /
`agentLoopContinue()` are `for await` async generators; the `Agent` class wraps them with
`subscribe()`. The low-level `pi-ai` `stream()` emits `text_start/delta/end`,
`thinking_*`, `toolcall_*`, `done`, `error`.
Sources: https://github.com/earendil-works/pi/blob/main/packages/agent/README.md,
https://github.com/earendil-works/pi/blob/main/packages/ai/README.md

**RPC mode (cross-process / cross-language):** JSONL over stdin/stdout.
- Framing: strict LF (`\n`)-delimited JSON. Strip a trailing `\r`. **Do not** use
  Node `readline` or other readers that split on Unicode separators (e.g. `U+2028`),
  because those characters appear inside JSON payloads.
- Send a prompt (client -> pi stdin):
  ```json
  {"id": "req-1", "type": "prompt", "message": "Hello"}
  ```
  Ack (pi stdout): `{"id": "req-1", "type": "response", "command": "prompt", "success": true}`
- Other commands: `steer`, `follow_up`, `abort`, `new_session`, `set_model`,
  `cycle_model`, `get_state`, `get_messages`, `set_thinking_level`, `bash`,
  `get_session_stats`, `switch_session`, `fork`, `clone`, `compact`, etc.
- Events stream back as JSON lines **without** an `id` (same event names as the SDK):
  ```json
  {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}
  {"type":"message_update","assistantMessageEvent":{"type":"text_end"}}
  {"type":"agent_end","messages":[...]}
  ```
- The optional `id` on a command is echoed back on its `response` for correlation. There
  is **no handshake** - the protocol starts immediately; the first client command begins
  interaction.
- Extension UI is also over the wire: `extension_ui_request` (stdout) /
  `extension_ui_response` (stdin) for `select`/`confirm`/`input`/`editor`, plus
  fire-and-forget `notify`/`setStatus`/`setWidget`.
Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md

**Streaming summary:** SDK = observer callbacks; agent-core/pi-ai = async generators;
RPC/JSON modes = JSON-lines event stream over stdout. No SSE or websockets in pi itself;
if Agenta needs SSE to a frontend, the backend wraps the JSONL/observer stream and
re-emits SSE.

---

## Question 3 - Startup hooks (file setup, secret injection, env prep)

pi has a rich **extension hook system**, plus an **app-level startup ordering** for the
sandbox that Agenta controls itself. Two layers:

### 3a. pi extension hooks (in-process, TypeScript)
Extensions are default-exported factory functions auto-discovered from:
- Global: `~/.pi/agent/extensions/*.ts` (or `.../*/index.ts`)
- Project: `.pi/extensions/*.ts` (or `.../*/index.ts`)
- CLI: `pi -e ./path.ts`
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => { /* file setup / state restore */ });
  pi.registerTool({ /* ... */ });
}
```
Factory functions may be **async**, which is the supported way to do startup
initialization (e.g. fetch remote config) before the session begins.
Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md

**Relevant hook points (25+ total) for startup/setup:**
- `project_trust` -> `{ trusted: "yes"|"no"|"undecided", remember? }` (gate before
  loading dynamic configs).
- `session_start` -> reason `"startup"|"reload"|"new"|"resume"|"fork"`. The documented
  place for one-time per-session setup and state restoration. This is the natural
  **file-setup hook**.
- `session_shutdown` -> cleanup / persist state (`pi.appendEntry(...)`).
- `resources_discover` -> contribute `skillPaths`/`promptPaths`/`themePaths` (how skills
  get injected).
- `before_agent_start` -> inject messages or modify the system prompt before the LLM turn.
- `context` / `before_provider_request` / `after_provider_response` -> mutate the
  messages/payload around each LLM call (good instrumentation points).
- `tool_call` -> can **block** a tool (`{ block: true, reason }`); `tool_result` can
  rewrite results.
Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md

**Secret injection at the pi layer** is via provider registration with env interpolation:
```typescript
pi.registerProvider("provider-name", {
  name: "Display Name",
  baseUrl: "https://api.example.com",
  apiKey: "$ENV_VAR",         // "$VAR" / "${VAR}" interpolated; "$$" -> literal "$"
  api: "anthropic-messages",
  models: [/* ... */],
});
```
And/or `AuthStorage` (SDK): resolution order is runtime overrides -> `auth.json` ->
environment variables -> fallback resolver:
```typescript
const authStorage = AuthStorage.create();
authStorage.setRuntimeApiKey("anthropic", process.env.MY_KEY); // not persisted
```
Sources: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md

### 3b. App-level (sandbox) startup ordering - Agenta's own hooks
The design doc's "startup hooks set up files then secrets" is the **sandbox boot
sequence**, which Agenta owns, not a pi API. pi's containerization doc shows secrets are
injected as env vars at container start and files via bind mounts:
```bash
docker run --rm -it \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v pi-agent-home:/root/.pi/agent \
  pi-sandbox
```
Three documented isolation modes: **Gondolin** (local micro-VM, tools run in VM, auth
stays on host), **plain Docker** (whole pi process containerized), and **OpenShell**
(policy-controlled gateway that can inject provider creds upstream so raw keys never
enter the sandbox). For Agenta's Daytona target, the equivalent is: lay files into the
workspace, then set secret env vars / write `auth.json`, then start `pi --mode rpc`.
Source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md

So "file setup then secrets" maps to: (1) sandbox provisioning lays config files
(AGENTS.md, skills, files) into the workspace and `~/.pi/agent`; (2) secrets are set as
env vars / `auth.json`; (3) pi boots and its own `session_start` extension hook can do any
remaining in-process setup. Note: pi's own hooks fire **inside** pi after it starts, so
they cannot themselves be the mechanism that installs pi's secrets before pi starts -
that ordering belongs to the sandbox layer (the `$ENV_VAR`/`auth.json` is read by pi at
boot).

---

## Question 4 - Returns as TEXT

- **Streaming:** `message_update` events carry `assistantMessageEvent.type ===
  "text_delta"` with `.delta`. Concatenate deltas for live text. (RPC/JSON modes emit the
  same shape on stdout.)
- **Final / multi-message:** the run produces an array of messages, not one completion.
  - SDK: `session.messages` (all) and the `agent_end` event's `messages` array; per-turn
    text is on `turn_end`'s `message`.
  - The `agent_end` event is the canonical "full multi-message output" the design doc
    wants. Each assistant message's `content` is an array of content blocks; text blocks
    are `{ type: "text", text }`.
- **print mode:** `pi -p "query"` prints assistant text to stdout directly (simplest text
  path for a one-shot run).
- **JSON mode filtering example** (text via `message_end`):
  ```bash
  pi --mode json "List files" 2>/dev/null | jq -c 'select(.type == "message_end")'
  ```
Sources: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md,
https://github.com/earendil-works/pi/blob/main/packages/ai/README.md

---

## Question 5 - Returns as IMAGES and other binary/file artifacts

pi-ai content blocks include an explicit image block; images are base64 + MIME type:
```typescript
type ContentBlock =
  | { type: 'text';  text: string }
  | { type: 'image'; data: string; mimeType: string }        // base64-encoded
  | { type: 'toolCall'; id: string; name: string; arguments: Record<string, any> }
  | { type: 'thinking'; thinking: string };
```
Tool results carry their own `content: ContentBlock[]`, so a tool can return an image
block:
```typescript
{
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];   // may include { type: 'image', data, mimeType }
  isError: boolean;
  timestamp: number;
}
```
- **Input images** (multimodal prompts): SDK `prompt(text, { images: [...] })` with
  `ImageContent` = `{ type: "image", source: { type: "base64", mediaType, data } }`
  (SDK shape). pi-agent-core's `prompt()` also accepts
  `[{ type: "image", data, mimeType }]`.
- **Generated images:** pi-ai exposes `getImageModel(provider, modelId)` and
  `generateImages(model, input, options)` (one-shot image generation).
- **Binary/file artifacts:** there is no dedicated "artifact" return channel. The two
  practical paths are (a) tools return an `image` content block (base64), or (b) the
  agent writes files to the sandbox workspace (write/bash tools) and Agenta collects them
  from the filesystem after the run. pi-agent-core's package description explicitly
  mentions "attachment support," which is worth confirming in source for non-image
  binaries.
Sources: https://github.com/earendil-works/pi/blob/main/packages/ai/README.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md,
`https://registry.npmjs.org/@earendil-works/pi-agent-core` (description). The
attachment/binary specifics are **UNVERIFIED** beyond the image block - confirm in
`packages/agent` source / `packages/ai` source.

---

## Question 6 - STRUCTURED OUTPUTS (JSON / schema-constrained)

pi's idiomatic structured-output pattern is **a terminating tool**, not a provider-level
`response_format`/`json_schema`. You define a tool whose TypeBox parameters are your
output schema and return `terminate: true` so the agent stops without an extra LLM turn;
the validated arguments are your structured object. See
`packages/coding-agent/examples/extensions/structured-output.ts`:
```typescript
defineTool({
  name: "save_structured_output",
  parameters: Type.Object({
    headline: Type.String({ description: "Short title for the result" }),
    summary: Type.String({ description: "One-paragraph summary" }),
    actionItems: Type.Array(Type.String(), { description: "Concrete next steps" }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Saved structured output: ${params.headline}` }],
      details: {                       // <-- machine-readable structured result
        headline: params.headline,
        summary: params.summary,
        actionItems: params.actionItems,
      } satisfies StructuredOutputDetails,
      terminate: true,                 // <-- ends agent without follow-up turn
    };
  },
});
```
You then read the structured object from that tool call's arguments / the tool result's
`details`. TypeBox is the schema system throughout pi (`Type`, `Static`, `TSchema` are
re-exported from `@earendil-works/pi-ai`), and `validateToolCall(tools, toolCall)`
validates arguments against the schema before execution.
Sources: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/structured-output.ts,
https://github.com/earendil-works/pi/blob/main/packages/ai/README.md

**UNVERIFIED:** whether `pi-ai`'s `complete()`/`stream()` accept a provider-native
`responseFormat`/`jsonSchema` option (OpenAI/xAI-style strict JSON schema). The README
did not document one; the documented, portable pattern is the terminating-tool approach
above. Confirm by reading `packages/ai` source (`complete`/`stream` option types).

---

## Question 7 - Tools, model selection, and the session_id

### Tools
**Built-in:** enable per session: `tools: ["read", "bash", "edit", "write", "grep",
"find", "ls"]`. Read-only mode = `["read","grep","find","ls"]`. `excludeTools: [...]`
removes specific ones.

**Custom (SDK):**
```typescript
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
const myTool = defineTool({
  name: "my_tool",
  label: "My Tool",
  description: "Does something useful",
  parameters: Type.Object({ input: Type.String({ description: "Input value" }) }),
  execute: async (_toolCallId, params) => ({
    content: [{ type: "text", text: `Result: ${params.input}` }],
    details: {},
  }),
});
await createAgentSession({ customTools: [myTool], tools: ["read", "bash", "my_tool"] });
```
**Custom (extension):** `pi.registerTool({...})` with the same shape plus TUI hooks
(`renderCall`, `renderResult`), `promptSnippet`, `promptGuidelines`, and optional
`onUpdate` streaming. `pi.getAllTools()`, `pi.getActiveTools()`, `pi.setActiveTools()`
manage the active set at runtime. `tool_call` hooks can block tools; MCP is composed via
extensions (not core).
Sources: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md

### Model selection
```typescript
import { getModel } from "@earendil-works/pi-ai";
const opus = getModel("anthropic", "claude-opus-4-5");      // built-in
const custom = modelRegistry.find("my-provider", "my-model"); // from models.json
const available = await modelRegistry.getAvailable();         // those with valid keys
await createAgentSession({
  model: opus,
  thinkingLevel: "high",  // off | minimal | low | medium | high | xhigh
  scopedModels: [ { model: opus, thinkingLevel: "high" }, { model: haiku, thinkingLevel: "off" } ],
  authStorage, modelRegistry,
});
await session.setModel(newModel);   // runtime switch
```
If no model is provided: restore from session -> settings default -> first available.
15+ providers (Anthropic, OpenAI, Google, Bedrock, Ollama, ...). RPC equivalent:
`set_model`/`cycle_model`; CLI flags `--provider`, `--model`. Custom providers are added
via `pi.registerProvider(...)`. This is the swap point for "run on OpenAI/Codex models."
Sources: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md,
https://pi.dev/

### session_id
- **Creation:** a session has a `sessionId`. In JSON mode the run opens with a header
  line: `{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path"}`.
  The `id` is the session id (UUID). The SDK exposes it as `session.sessionId`; the
  `Agent` constructor accepts an explicit `sessionId` (so Agenta can supply its own and
  thread it through).
- **Threading:** sessions persist as JSONL files (`SessionManager.create(cwd)` for
  on-disk, `SessionManager.inMemory()` for none). `createAgentSessionRuntime` supports
  `newSession`/`switchSession`/`fork`/`importFromJsonl`, i.e. resume and branch by
  session. In RPC mode, `new_session`/`switch_session`/`fork`/`clone` manage sessions; the
  client correlates its own requests with the optional `id` field on each command.
- This matches the design doc's "carry a `session_id`... later have its state stored":
  pi already persists session state to JSONL, and you can pass your own `sessionId`.
Sources: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md,
https://github.com/earendil-works/pi/blob/main/packages/agent/README.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md

---

## Instrumentation ("pi instruments") - important nuance

The design doc says runs are "instrumented with pi instruments." Findings:
- pi core ships **no product literally called "instruments."** Observability is delivered
  through the **extension/hooks API** (you can instrument any of `context`,
  `before_provider_request`, `after_provider_response`, `tool_call`, `tool_result`,
  `agent_start/end`, `turn_start/end`, etc.).
- The mature path is **`pi-otel`**, a community OpenTelemetry extension:
  - Install: `pi install npm:pi-otel`; activate `/otel start`.
  - Span tree per prompt: `pi.interaction` -> `pi.turn` -> `pi.llm_request` /
    `pi.tool.<name>`, with GenAI semantic-convention attributes (model, token counts,
    finish reason).
  - Metrics: histograms for LLM request latency, token usage (input/output/cache), tool
    execution time.
  - Structured log events: `pi.session.start`, `pi.session.end`, `pi.tool.error`.
  - Config via standard OTel env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`,
    `OTEL_EXPORTER_OTLP_HEADERS`) or `.pi/settings.json` `{ "otel": { endpoint, protocol } }`;
    `PI_OTEL_DISABLED=1` disables it.
- There is also a proposed (issue-stage) session usage stats sink via `PI_USAGE_DIR`.
Sources: https://nikiforovall.blog/ai/productivity/2026/05/16/pi-otel.html,
https://github.com/earendil-works/pi/issues/2054,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md

**Implication for Agenta:** "pi instruments" most likely means "instrument pi via its
hooks (OTel-style)," and Agenta's existing OTel-based tracing/observability can ingest
`pi-otel` OTLP output directly, or Agenta can write its own thin extension that emits
spans on the same hook points. Confirm with the design owner whether "pi instruments"
refers to `pi-otel`, a private Earendil "instruments" API, or just "instrumented via
hooks" - this wording is **UNVERIFIED**.

---

## Local execution parity & swappable harness (design requirements)

- **Parity:** the same `pi` binary / SDK that runs in the sandbox runs locally; pulling
  the agent config (AGENTS.md, skills, model, tools, files, secrets) and starting pi
  locally yields the same behavior. The four run surfaces are identical local vs sandbox.
  Containerization doc shows host vs container are the same pi.
- **Swappable harness:** because the contract is a thin run surface (RPC JSONL / JSON
  events / SDK events), a non-pi harness (e.g. OpenAI Codex) can be slotted behind the
  same surface if Agenta defines its harness port against the RPC/event shapes. Within pi,
  model/provider swapping (incl. OpenAI) is `getModel`/`registerProvider`/`set_model` -
  but "swap the whole harness" is an Agenta-side abstraction over the run surface, not a
  pi feature.
Sources: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md,
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md, https://pi.dev/

---

## Open questions / unknowns

1. **"pi instruments" exact meaning** - is it `pi-otel`, a private Earendil API, or
   "instrument via hooks"? UNVERIFIED. Resolve with the design owner; if OTel, wire
   `pi-otel` OTLP into Agenta's existing tracing.
2. **Provider-native structured output** - does `pi-ai` `complete()`/`stream()` accept a
   `responseFormat`/`jsonSchema` option, or is the terminating-tool pattern the only
   supported route? UNVERIFIED; confirm in `packages/ai` source.
3. **Non-image binary artifacts** - `pi-agent-core` advertises "attachment support," but
   only the `image` content block is documented. How are arbitrary file/binary artifacts
   returned (vs. written to the workspace and collected from disk)? UNVERIFIED; confirm in
   `packages/agent`/`packages/ai` source.
4. **Daytona specifically** - pi documents Gondolin / Docker / OpenShell, not Daytona. The
   Daytona port is Agenta's to build (lay files -> set secrets -> `pi --mode rpc`); no pi
   Daytona integration exists today.
5. **Skills config -> pi** - how Agenta's stored "skills" map to pi skills (loaded via
   `resources_discover` skillPaths and `~/.pi/agent` layout) needs a concrete mapping;
   read `docs/settings.md` and the skills section of the SDK/extensions docs.
6. **Exact `agent_end.messages` schema** for storing multi-message output - capture the
   precise `AgentMessage`/content-block JSON (read `packages/agent` types) before
   designing Agenta's storage shape.
7. **Version pinning** - researched against `0.79.4`. The API is pre-1.0 and moving (RPC
   command names, event names, hook names may change between minors); pin a version and
   re-verify against that tag's docs before implementing.

## Sources

- https://pi.dev/ (and https://pi.dev/docs/latest)
- https://github.com/earendil-works/pi (repo root, package layout)
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/structured-output.ts
- https://github.com/earendil-works/pi/blob/main/packages/agent/README.md
- https://github.com/earendil-works/pi/blob/main/packages/ai/README.md
- https://registry.npmjs.org/@earendil-works/pi-coding-agent (and /pi-ai, /pi-agent-core) - version, license, bin, deps
- https://nikiforovall.blog/ai/productivity/2026/05/16/pi-otel.html (pi-otel OTel extension)
- https://github.com/earendil-works/pi/issues/2054 (PI_USAGE_DIR usage stats proposal)
- https://deepwiki.com/earendil-works/pi (and /7.1-pi-coding-agent-sdk, /6.3-extension-examples-and-patterns)
