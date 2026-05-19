# n8n self-hosted — empirical tracing findings

**Run date:** 2026-05-19
**n8n version:** 2.20.11 (Docker image `docker.n8n.io/n8nio/n8n:latest`)
**OTel libs bundled in n8n:** `@opentelemetry/api@1.9.0`, `@opentelemetry/sdk-node@0.213.0`, `@opentelemetry/exporter-trace-otlp-proto@0.213.0`
**Spike workflow:** one Webhook node → one HTTP Request node calling OpenAI's `/v1/chat/completions`
**Target:** Agenta cloud `http://host.docker.internal/api/otlp/v1/traces?project_id=...`

## What n8n emits (verified)

n8n's native OTel module produces exactly **two span types** per workflow execution:

### `workflow.execute` (one per execution)

```json
{
  "n8n": {
    "workflow": {
      "id": "e90912a24bcf42e7",
      "name": "Agenta spike — HTTP Request to OpenAI",
      "node_count": 2,
      "version_id": "9486742f-379c-4b49-9255-595d8a396c5c"
    },
    "execution": {
      "id": "2",
      "mode": "webhook",
      "status": "error",
      "is_retry": false,
      "error_type": "ExpressionError"
    }
  },
  "service": {"name": "vercel-ai-spike-n8n"}
}
```

### `node.execute` (one per node, nested under `workflow.execute`)

```json
{
  "n8n": {
    "node": {
      "id": "http-openai",
      "name": "OpenAI HTTP Request",
      "type": "n8n-nodes-base.httpRequest",
      "type_version": 4.2,
      "items": {"input": 1, "output": 0}
    }
  }
}
```

All spans share one `trace_id` per workflow run — `workflow.execute` is the parent, `node.execute` spans are children.

## What n8n does NOT emit

**Critical gap for LLM observability.** The traces above lack:

- ❌ `gen_ai.*` / `ai.*` semantic attributes (no model name, no prompt, no completion, no token counts)
- ❌ `http.*` attributes on HTTP Request nodes (even though the node is literally making an HTTP call)
- ❌ Node input/output payload values — only `items.input` / `items.output` **counts**
- ❌ No span for the upstream LLM HTTP call itself

**Mechanism (source-verified, not just empirical).** Four checks against the installed n8n image confirm this is n8n's design, not a setup gap on our side:

1. **`OtelService.init()`** in `/usr/lib/node_modules/n8n/dist/modules/otel/otel.service.js` instantiates `NodeSDK({ resource, traceExporter, sampler })`. **No `instrumentations` array is passed.** Without an `instrumentations` array, `NodeSDK` does not register any OTel auto-instrumentation — not `instrumentation-http`, not `instrumentation-undici`, not anything.
2. **`grep -rln "registerInstrumentations\|instrumentations:" /usr/lib/node_modules/n8n/dist`** returns zero matches. n8n never registers auto-instrumentations anywhere in its dist code.
3. **The `@opentelemetry/instrumentation-http` / `instrumentation-undici` / etc. packages ARE bundled** under `node_modules/.pnpm/`, but only as transitive peer-deps pulled by LangChain. n8n itself doesn't import or register them.
4. **`OtelLifecycleHandler.onNodeEnd`** exposes a `customAttributes` hook that reads `ctx.taskData.metadata?.tracing` — a per-node opt-in surface where a node implementation could attach arbitrary OTel attributes (including `gen_ai.*`). **`grep` across `@n8n/n8n-nodes-langchain` and the rest of `node_modules` shows zero writes to `metadata.tracing`.** Neither the LangChain AI nodes nor any other built-in node uses this hook.

So even if we'd used the purpose-built `n8n-nodes-langchain.openAi` node instead of HTTP Request, the resulting `node.execute` span would still have only `n8n.node.type = "@n8n/n8n-nodes-langchain.openAi"` and `items.input/output` counts. No model name, no prompt, no tokens. **Confirmed structurally, not just empirically.**

**Three paths forward** (none of them are v1 SDK work):

- An n8n upstream PR adding `metadata.tracing` writes in the LangChain AI node implementations — the cleanest fix, would benefit every n8n user.
- A custom n8n node that wraps AI calls and sets `metadata.tracing.gen_ai_*` itself — user-installable, no n8n core change required.
- A separate process-level OTel auto-instrumentation for LangChain JS (e.g. via `--require @arizeai/openinference-instrumentation-langchain/register`) — operates outside n8n's awareness.

**Cross-process propagation works partially.** With `N8N_OTEL_TRACES_INJECT_OUTBOUND=true` (default), n8n injects W3C `traceparent` headers into outbound HTTP. If the downstream service emits its own OTel, those spans become children of the n8n trace. OpenAI's API does not, so the n8n → OpenAI hop is a dead-end for LLM telemetry.

## Config gotchas we hit and how to avoid them

1. **n8n uses its own `N8N_OTEL_*` env vars, NOT the standard `OTEL_*` vars.** Setting `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is ignored. Use `N8N_OTEL_EXPORTER_OTLP_ENDPOINT` + `N8N_OTEL_EXPORTER_OTLP_TRACING_PATH`.

2. **`buildOtlpTracesUrl` is a simple concatenation** (`endpoint + path`). To get Agenta's `?project_id=...` query parameter through, stuff it into the path env var:
   ```
   N8N_OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal
   N8N_OTEL_EXPORTER_OTLP_TRACING_PATH=/api/otlp/v1/traces?project_id=<uuid>
   ```

3. **Auth is via `N8N_OTEL_EXPORTER_OTLP_HEADERS`**, comma-separated `key=value` pairs:
   ```
   N8N_OTEL_EXPORTER_OTLP_HEADERS=Authorization=ApiKey <key>
   ```

4. **From inside Docker, `AGENTA_HOST=http://localhost` does not reach the host's Agenta.** Use `http://host.docker.internal` on Docker Desktop for Mac (and `--add-host=host.docker.internal:host-gateway` on Linux Docker).

## Implications for the Agenta TypeScript SDK proposal

n8n's tracing story sits in a similar place to Mastra's (proposal §1.10):

- **Framework emits its own OTel spans** (good — they land in Agenta with no custom code)
- **Framework does NOT capture LLM call details** (bad — no model, no prompt, no tokens)
- **A separate JS-side adapter would be needed for LLM-level observability** — equivalent to `@agenta/sdk-mastra`'s approach, except the adapter shape for n8n is "install an OTel auto-instrumentation library for LangChain JS as a custom n8n node" rather than a `BaseExporter` subclass

What v1 covers for free:
- Workflow-level observability in Agenta (which workflows ran, which nodes ran, error types, execution mode, item counts)
- Cross-trace correlation if the n8n workflow calls an Agenta-instrumented downstream service (via W3C traceparent injection)

What v1 does NOT cover:
- LLM-call detail for AI/LangChain nodes inside n8n. The Agenta UI's LLM-call view (model, inputs, outputs, tokens, cost) will be empty for n8n-originated traces unless the user installs additional instrumentation.

**Recommended user docs**: a one-pager explaining the n8n + Agenta setup (the env vars above), with an honest note about the LLM-detail gap and a pointer to OpenInference-style instrumentation as the path to richer telemetry. Not a v1 SDK package.
