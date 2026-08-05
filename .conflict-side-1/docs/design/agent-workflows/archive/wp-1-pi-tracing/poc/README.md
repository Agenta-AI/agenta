# WP-1 POC: trace the Pi agent harness into Agenta

Installs [Pi](https://pi.dev) locally, runs a small tool-using agent, and exports the
run to Agenta observability as a clean OpenTelemetry trace.

## What's here

- `agenta-otel.ts` — the deliverable: a Pi extension that turns `pi.on(...)` lifecycle
  events into OTel spans and exports them (OTLP/HTTP protobuf) to Agenta. WP-2 embeds
  this file as-is.
- `run.ts` — a runner that registers the extension in-process and drives one prompt.

## Span tree

```
invoke_agent              (openinference.span.kind = AGENT, carries session.id)
  turn N                  (CHAIN)
    chat <model>          (LLM   — model, latency, token usage, finish reason)
    execute_tool <name>   (TOOL  — args + result)
```

Token usage is emitted under both the current (`input_tokens`/`output_tokens`) and
legacy (`prompt_tokens`/`completion_tokens`) GenAI names, so Agenta maps it regardless
of which adapter claims the span.

## Setup

```bash
pnpm install --ignore-workspace
```

### Authenticate Pi (one time)

The runner uses `~/.pi/agent/auth.json`. Log in with your ChatGPT subscription — no API
key, no per-token billing:

```bash
pnpm exec pi          # opens the TUI
/login                # choose "ChatGPT Plus/Pro (Codex)", finish the browser OAuth
# then quit the TUI
```

Alternatively, export `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

### Credentials for Agenta

The runner reads `AGENTA_HOST` / `AGENTA_API_KEY` from a local `.env` (see `.env.example`)
or, failing that, from the repo-root `.env.test.local`.

## Run

```bash
pnpm start                 # uses gpt-5.5 by default
PI_MODEL=gpt-5.4 pnpm start # pick another available model
```

The runner prints the `trace_id` and a `/api/spans/?trace_id=...` fetch URL on exit.
Then open Agenta observability and find the `invoke_agent` trace.

> Note: `gpt-5.3-codex-spark` is **not** usable on a ChatGPT (Codex) login — it 400s.
> Use `gpt-5.5` / `gpt-5.4`.

## Verified mapping (Agenta conventional semantics)

A run produces a coherent tree that types and maps correctly:

```
invoke_agent (agent)   ag.data.inputs={prompt}, ag.data.outputs=text, ag.session.id, cumulative tokens
  turn N (chain)
    chat <model> (chat) ag.data.inputs.prompt[] + ag.data.outputs.completion[] (OpenInference
                        messages), ag.meta.request.model, incremental token usage
    execute_tool <name> (tool)  ag.data.inputs={args}, ag.data.outputs=result
```

Two things make the data land in `ag.data` instead of `ag.unsupported`:
`ag.data.inputs` must be a **JSON object** (Agenta exiles non-dict inputs), so the agent and
tool spans emit `input.value` as JSON; the chat span emits OpenInference
`llm.input_messages.*` / `llm.output_messages.*` so it renders as a message thread. Token
usage is emitted under both the new (`input_tokens`) and legacy (`prompt_tokens`) names.

A third thing makes the **agent-root token/cost totals correct**: Agenta rolls metrics up
its span tree by sorting on millisecond-resolution `start_time` and attaching a span only
once its parent is present. Same-millisecond siblings (e.g. `agent_start`/`turn_start`)
tie and can drop a subtree from the roll-up. So the extension buffers each trace and
exports it in one OTLP batch when the root span ends, ordered **parent-first** — without
this, a multi-turn agent root undercounts (shows only the last turn's tokens/cost).
