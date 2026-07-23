# Trace inventory

This inventory broadens the research beyond cost. It follows runner-emitted trace information
through Agenta ingestion and records which gaps this project fixes.

## Span structure and identity

| Concern | Runner source | API handling | Finding | Scope |
|---|---|---|---|---|
| trace and parent ids | incoming W3C `traceparent`; runner span context | native OTel tree | separate batches complicate cumulative rollup | usage attribution design |
| agent span | `invoke_agent`, AGENT | Agenta agent node | usage is repeated as incremental summary | fix after CTO approval |
| turn span | Pi emits real turns; ACP emits one synthetic turn | chain node | ACP cannot express each internal model round | document limitation |
| LLM span | Pi per call; ACP synthetic per run | chat node | fidelity differs by harness | usage normalization and docs |
| tool span | tool call/update events | tool node | ordering and orphan handling belong to recorder refactor | defer |
| session identity | session/conversation attributes | session metadata | present, but not part of usage reconciliation | verify regression only |

## Model request and response

| Field | Runner behavior | API destination | Gap and disposition |
|---|---|---|---|
| provider/system | Pi message or selected connection | provider metadata | preserve on every model-scoped usage observation |
| requested model | run config | `ag.meta.request.model` | keep distinct from response model |
| response model | assistant message when available | `ag.meta.response.model` | required for model-scoped pricing |
| response id | Pi assistant message when available | response metadata | preserve; ACP may not expose it |
| finish reasons | assistant stop reason | response metadata | partial/error usage must not be dropped |
| request parameters | limited runner config | request metadata | inventory only |

## Content and policy

| Field | Runner behavior | Gap and disposition |
|---|---|---|
| input/output messages | captured on LLM and agent spans | keep existing capture behavior |
| tool input/output | captured on tool spans | unrelated ordering gaps remain in recorder-refactor project |
| content capture policy | `telemetry.capture.content.enabled` | suppress content without suppressing numeric usage |
| redaction | runner redacts events and errors | do not retain raw provider payload by default |

## Status, errors, and timing

| Field | Runner behavior | Gap and disposition |
|---|---|---|
| span status and exception | error paths mark spans | partial usage disappears on some failures; fix upstream |
| stop reason | run and assistant result | preserve alongside usage status |
| start/end and duration | native span timing | no cost-specific change |
| export failure | tracing degrades best effort | weak diagnostics are a related follow-up |

## Usage, context, and cost

| Field | Current state | Target |
|---|---|---|
| inclusive input/output | ambiguous and harness-dependent | normalize to pinned OTel meaning |
| cache read/creation | lost in run result/rollup | preserve as input subcategories |
| reasoning | not carried by neutral usage | preserve as output subcategory when reported |
| total tokens | arithmetic, provider total, or ACP context used | canonical input + output plus mismatch metadata |
| context used/window | conflated with billed total; window dropped | separate gauge object/event |
| cost amount | bare scalar | currency, provenance, model scope, and status |
| cost components | discarded | retain mutually exclusive components |
| reported versus estimated | indistinguishable | explicit kind/source and fallback-only estimation |
| aggregation | repeated across leaf and parents | one incremental owner plus approved strategy |

## Adapter and semantic-convention classification

The API has overlapping mappings in the generic semconv, Logfire/GenAI, OpenInference,
OpenLLMmetry, Vercel AI, and direct Agenta adapters. They do not support the same detail or naming.

Phase 4 must produce a table with one row per emitted field:

```text
wire fact | runner attribute | classification/version | adapter mapping | canonical ag path |
aggregation | compatibility alias | documentation link
```

At minimum it covers operation name, span kind, provider, requested and response model, response
id, finish reason, messages, tool identity and arguments, session identity, errors/status,
content-capture policy, all token buckets, context gauges, cost components, currency, provenance,
and estimation metadata.

## Scope decision

This project fixes usage normalization, context separation, cost provenance, model-scoped
attribution, incremental ownership, and the related semantic convention. It verifies that model,
identity, status, timing, content policy, and tool fields do not regress.

It defers generic tool-event ordering, exporter concurrency/cache lifetime, export-failure
diagnostics, and the trace-recorder file refactor unless they block correct usage attribution.
