# WP-1: Tracing Pi in Agenta

Status: done. Working code in [`poc/`](poc/). To embed it in the agent runtime, follow
[`integrating-the-tracing-extension.md`](integrating-the-tracing-extension.md).

## Goal

Install Pi locally, run an agent, and get its telemetry into Agenta as a clean, structured
trace. Success looks like: a local Pi run shows up in Agenta observability as a sensible
span tree (session at the root, turns under it, LLM calls and tool calls as child spans)
with token usage and timings intact.

## Scope

In:

- Run Pi locally (`@earendil-works/pi-coding-agent`), pin an exact version.
- A Pi extension on the `pi.on(...)` event bus that converts lifecycle events
  (`session_start`, `turn_*`, `before_provider_request`/`after_provider_response`,
  `tool_execution_*`, `message_*`) into OTel spans.
- Export OTLP/HTTP protobuf to Agenta's `POST /otlp/v1/traces`.
- Make the span tree read well in Agenta's UI.

Out (later work packages):

- Running inside Daytona. Local only here.
- The agent service itself (that is WP-2). This WP produces the tracing extension that
  WP-2 later embeds.

## Approach (grounded in research)

See [`../research/otel-instrumentation.md`](../research/otel-instrumentation.md) and
[`../research/pi-interaction.md`](../research/pi-interaction.md).

- Pi emits no OTel on its own. Either adopt/fork a community extension (`pi-otel*`) or write
  our own on the event bus. Writing our own is likely cleaner since we control the span
  shape.
- Emit OTel GenAI semantic conventions (`gen_ai.*`) plus `openinference.span.kind`
  (AGENT / CHAIN / LLM / TOOL) so Agenta types the nodes correctly. Agenta's adapter
  registry already understands both.
- Export over OTLP/HTTP protobuf with `Authorization: ApiKey <key>` and `?project_id=<uuid>`.

## Known gotchas to handle

- **Token attribute drift.** Pi-style extensions emit `gen_ai.usage.input_tokens` /
  `output_tokens`, but Agenta's `semconv.py` maps the older
  `prompt_tokens` / `completion_tokens` / `total_tokens`. Either normalize in the extension
  or add aliases in Agenta, or token metrics drop silently.
- **Transport.** Agenta accepts OTLP/HTTP protobuf only. Not gRPC default, not JSON-OTLP.
  Configure the exporter accordingly.
- **Trace-context propagation.** Whether a W3C `traceparent` is threaded into the run so
  in-sandbox spans nest under an originating backend span is UNVERIFIED. Confirm during this
  WP.

## Definition of done

- A local Pi run produces one trace in Agenta with a coherent span tree.
- LLM and tool spans are typed correctly and carry model, latency, and token usage.
- No silently dropped attributes (token usage in particular is present).
- The exporter config (endpoint, auth, project) is injected, not hard-coded, so it carries
  over to the sandboxed and service contexts later.

## Open questions

- Adopt a community `pi-otel` extension or write our own? Lean: write our own.
- Final span-tree shape to standardize on (session vs interaction root naming).
- Does Agenta forward `traceparent` into an invocation for nesting?

## Links

- [`../research/otel-instrumentation.md`](../research/otel-instrumentation.md)
- [`../research/pi-interaction.md`](../research/pi-interaction.md)
- [Project README](../README.md)
