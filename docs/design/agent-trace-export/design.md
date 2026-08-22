# Design: the runner builds and sends every span

## The target in one paragraph

The Pi extension stops building OpenTelemetry spans and stops sending them. It keeps every hook
it has today, and on each hook it appends one JSON line to a file in the relay directory
describing what just finished: a turn, a model call, or a tool call. The runner drains that file
while the turn runs, turns each line into a real span under the run's root span, and exports the
whole tree in one batch when the turn ends, using a credential that lives only in the runner and
that the runner refreshes for as long as the turn lasts. Harnesses that produce no records keep
getting their spans built from the ACP event stream, exactly as today. Nothing changes in the
Agenta API.

```
 sandbox (untrusted)                        runner (trusted)                    Agenta API
 ------------------                         ----------------                    ----------
 Pi                                         run-turn.ts
  |  before_provider_request                 |
  |  turn_start / turn_end        RelayHost  |  span-records.ts (drain)
  |  tool_execution_start/end      read      |    |
  v                              ---------->  |    v
 agenta extension                            |  otel.ts createSandboxAgentOtel
  |  append JSON line                        |    applySpanRecord -> real spans
  v                                          |    root invoke_agent (runner-owned)
 <relayDir>/.agenta-spans.jsonl              |    redactor applied at the sink
                                             |    credential resolved at export time
                                             |         |
                                             |         v  one OTLP batch at turn end
                                             |    ------------------------------->  /otlp/v1/traces
```

## Who owns what

| Layer | Owns | Does not own |
| --- | --- | --- |
| Harness extension (in sandbox) | Observing the run. Knowing when a model call starts and ends, which model and provider served it, how many tokens it used, which tools ran with which arguments and results. Writing one span record per finished unit. | Trace ids, span ids, span names, span kinds, attribute keys, the OTLP endpoint, any credential, batching, retries, redaction. |
| Relay channel | Moving bytes from the sandbox to the runner on both placements. Nothing else. | Any understanding of what the bytes mean. |
| Runner tracing module | Creating the root span from the caller's trace context. Turning records into spans: names, kinds, attribute keys, parent links, timestamps. Enforcing content capture and size budgets. Redaction. Holding and refreshing the export credential. Batching and flushing. Retry and failure reporting. | Deciding when a model call happened. That is the harness's knowledge. |
| Agenta API | Ingesting the OTLP batch at `POST /otlp/v1/traces`. | Anything new. This layer does not change. |

The line that matters: **the harness reports facts, the runner decides span shape.** A harness
that learns to report a new fact needs no runner change beyond a mapping. A change to span
naming or attribute keys needs no sandbox change at all.

## The span record contract

One JSON object per line, appended to a file. Records are written when a unit **finishes**, so a
record always carries both timestamps and is never amended.

```jsonl
{"v":1,"id":"t0","parent":null,"type":"turn","startedAtMs":1755870000123,"endedAtMs":1755870004567,"attributes":{"index":0}}
{"v":1,"id":"c1","parent":"t0","type":"chat","startedAtMs":1755870000200,"endedAtMs":1755870002100,"attributes":{"provider":"openai","requestModel":"gpt-5.6-luna","responseModel":"gpt-5.6-luna","responseId":"resp_x","finishReason":"tool_use","usage":{"input":1200,"output":88,"total":1288,"cacheRead":1024,"cacheWrite":0,"cost":0.0031},"inputMessages":[],"outputMessages":[]}}
{"v":1,"id":"k1","parent":"t0","type":"tool","startedAtMs":1755870002200,"endedAtMs":1755870004500,"attributes":{"name":"bash","callId":"call_abc","input":{"command":"ls"},"output":"README.md\n","isError":false}}
```

### Envelope fields

Each field is classified by what it is, not by the feature it serves.

| Field | Type | Role | Meaning |
| --- | --- | --- | --- |
| `v` | integer | protocol context | Contract version. Currently `1`. The runner drops a record whose `v` it does not know and counts the drop. |
| `id` | string, 1 to 64 chars | protocol context | Correlation id, unique within one turn, minted by the harness. Never a span id. |
| `parent` | string or `null` | protocol context | The `id` of the enclosing record, or `null` meaning "a direct child of the run root". |
| `type` | `"turn"`, `"chat"`, `"tool"` | protocol context | Discriminator. A closed set. Adding one is a contract change. |
| `startedAtMs` | number | data | Unix epoch milliseconds when the unit started. |
| `endedAtMs` | number | data | Unix epoch milliseconds when it finished. |
| `error` | string, optional | data | Present when the unit failed. Sets the span status to error with this message. |
| `attributes` | object | data | Per-type facts. Table below. |

There is no field for an endpoint, a header, a token, a project, or a trace id. That absence is
the design: **the record contract carries no credentials, no routing, and no policy**, so a
sandbox that can write records gains nothing it could spend anywhere else.

### Per-type attributes

| `type` | Attribute | Meaning |
| --- | --- | --- |
| `turn` | `index` | The turn number within the run. Optional. |
| `chat` | `provider` | Provider that served the call, for example `openai`. |
| | `requestModel` | Model the harness asked for. |
| | `responseModel` | Model that answered, when it differs. |
| | `responseId` | Provider response id. |
| | `finishReason` | Why the call stopped. |
| | `usage` | `{input, output, total, cacheRead, cacheWrite, cost}`. Any member may be absent. |
| | `inputMessages` | The message array handed to the model. Content-gated. |
| | `outputMessages` | The assistant message the model returned. Content-gated. |
| `tool` | `name` | Tool name. |
| | `callId` | The harness's tool call id, so the span can be correlated with the ACP `tool_call` event. |
| | `input` | Tool arguments. Content-gated. |
| | `output` | Tool result text. Content-gated. |
| | `isError` | Whether the tool failed. |

"Content-gated" means the harness omits the field when
`AGENTA_AGENT_CONTENT_CAPTURE_ENABLED` is `false`, and the runner drops it if it arrives anyway.
Both sides enforce it, because only the runner side is trustworthy.

### How the runner turns a record into a span

The mapping reproduces exactly what `createAgentaOtel` builds today, so a trace after the change
looks like a trace before it.

| Record | Span name | `openinference.span.kind` | Attributes set by the runner |
| --- | --- | --- | --- |
| `turn`, `index` present | `turn <index>` | `CHAIN` | `pi.turn.index` |
| `turn`, no index | `turn` | `CHAIN` | none |
| `chat`, `requestModel` present | `chat <requestModel>` | `LLM` | `gen_ai.operation.name=chat`, `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`, the full `gen_ai.usage.*` set built by the existing helper at `services/runner/src/tracing/otel.ts:640-666`, `llm.input_messages`, `llm.output_messages` |
| `chat`, no model | `chat` | `LLM` | same, minus the model keys |
| `tool` | `execute_tool <name>` | `TOOL` | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `input.value`, `output.value` |

The root span stays runner-owned and is unchanged: `invoke_agent`, kind `AGENT`,
`gen_ai.agent.name`, `session.id`, `gen_ai.conversation.id`, `ag.meta.skills.loaded`, the run
usage totals, and the prompt. The runner already builds it in `createSandboxAgentOtel.start`
(`otel.ts:1387-1393`), and it already knows every one of those values without asking the
sandbox.

Timestamps come from the record, not from the clock. OpenTelemetry for JavaScript accepts an
explicit `startTime` in `SpanOptions` and an explicit `endTime` in `span.end(endTime)`, so the
runner materializes a finished span with the harness's own times whenever the record arrives.
This is what makes lazy draining correct: a record read a minute after the event still produces
a span with the right duration.

### Skew between the two clocks

The harness clock and the runner clock are the same clock on a local sandbox and different
clocks on Daytona. The record times are used verbatim, so a Daytona sandbox with a skewed clock
produces child spans whose times sit outside the runner-owned root. The runner clamps each
record's `startedAtMs` and `endedAtMs` into the root span's own interval before creating the
span, and stamps `ag.meta.trace.clock_clamped=true` on the root when it had to clamp. That keeps
the tree renderable and makes the skew visible rather than silent.

## The transport

**Path.** `<relayDir>/.agenta-spans.jsonl`, a sibling of the existing usage file
(`run-plan.ts:721`). The runner passes only the path, in a new environment variable
`AGENTA_AGENT_SPAN_RECORD_PATH`, set in `buildPiExtensionEnv`
(`pi-assets.ts:476-544`) beside the existing `AGENTA_AGENT_USAGE_CAPTURE_PATH`.

**Why inside the relay directory.** The relay directory is deliberately kept off the object
store mount because a mount write can fail with `ENOTCONN` (`run-plan.ts:644`, `:721`). It is
reachable from both sides on both placements. The relay sweep only removes files whose names
match the request and response suffixes (`isRelayFileName`, `services/runner/src/tools/relay.ts:494-504`),
and the comment there already accounts for non-relay files living in the directory, so a
dot-prefixed `.jsonl` is safe from the sweep with no code change.

**Writing.** The harness appends one complete line per record with a single `appendFileSync`
call. Appends of a small buffer to a regular file are atomic with respect to the file offset, so
concurrent hooks cannot interleave halves of two records.

**Reading.** The runner keeps a byte offset per turn. On each drain it reads the file through
`RelayHost.read` (`relay.ts:227-261`), takes the bytes after the offset, consumes only up to the
last newline, parses each complete line, and advances the offset to that newline. A partial tail
line is left for the next drain. This is the only handling partial writes need.

**Per-turn lifecycle.** The relay directory is created once per environment
(`prepareWorkspace`, `services/runner/src/engines/sandbox_agent/workspace.ts:50`), and a warm
session reuses it across turns. So the runner removes the record file and resets its offset to
zero when it dispatches a turn, at the same point in `run-turn.ts` that writes per-turn sandbox
state today (`run-turn.ts:263-271`, which this design deletes and replaces). The runner owns turn
boundaries, so the runner owns the reset. One `RelayHost.remove` call per turn, which on Daytona
is one daemon call, negligible next to the per-turn work already done.

**Drain cadence.** Every 2 seconds while a turn is running, and once more after the prompt
resolves and before the flush, at the same point `readRunUsage` is called today
(`run-turn.ts:1149-1156`). Draining during the turn is not for latency, since nothing is exported
until the end. It is so a turn that dies, or a sandbox that is destroyed, still yields the spans
that had already been recorded.

## Trace identity and parent and child

The runner creates the root. `createSandboxAgentOtel.start` parses the caller's `traceparent`
from `request.context.propagation.traceparent` and starts `invoke_agent` as a child of that
remote span, so the run joins the caller's `/invoke` trace (`otel.ts:1387-1393`, mirroring the
extension's own logic at `otel.ts:755-788`).

Records are attached under it by resolving `parent`:

- `parent: null` means a direct child of `invoke_agent`.
- `parent: "<id>"` means a child of the span the runner already created for that `id`.
- An unknown `parent` means the record arrived before its parent's record. The runner holds it
  in a small pending map keyed by parent id and materializes it when the parent lands. In
  practice this never happens, because a record is written when its unit finishes and a child
  finishes before its parent. At the end of the drain, anything still pending is attached
  directly to `invoke_agent` and counted.

**The sandbox never sees a trace id or a span id.** The runner no longer sets `TRACEPARENT` or
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` in the sandbox environment (`pi-assets.ts:488-492`), so a
forged record cannot name another trace, and an in-sandbox process cannot learn the caller's
trace identity from its own environment.

## The export credential

This is the part that fixes long turns, and it is the smallest change in the design.

Today the credential is captured as a string at turn start and frozen for the run. The string is
read into `createSandboxAgentOtel` at `otel.ts:1204` and pinned onto the trace by
`registerRunTarget` (`otel.ts:1138-1148`). The token lives 15 minutes
(`_SECRET_EXP` in `api/oss/src/middlewares/auth.py`). The export happens at turn end. A turn
longer than 15 minutes exports with a dead token.

The runner already holds a live one. The alive watchdog refreshes the run credential every Nth
heartbeat by calling `GET /access/permissions/check`, which always re-mints, and it exposes the
current value through a getter, `credential: () => string`
(`services/runner/src/sessions/alive.ts:193`, `:249`, refresh at `:226-232`, mechanism at
`services/runner/src/sessions/auth.ts:18-35`). The records emitter and the heartbeat already use
that getter rather than a snapshot.

The change: `ExportTarget.authorization` becomes a function instead of a string.

```ts
interface ExportTarget {
  endpoint: string;
  /** Resolved at export time, never at run start: a turn can outlive the token. */
  authorization?: () => string | undefined;
}
```

`run-turn.ts` passes the watchdog's `credential` getter where it passes a string today. Runs with
no watchdog, meaning one-shot runs outside a session, pass a closure over
`runCredential(request)`, which is exactly today's behavior for those runs.

`TraceBatchProcessor.flush` calls the function once, when it is about to export
(`otel.ts:320-360`). Both existing consumers of the value keep working: the "skip a
credential-less export to Agenta's own ingest" rule (`otel.ts:340-347`) and the export
diagnostics.

The exporter cache needs one adjustment. `OTLPTraceExporter` bakes its headers at construction,
so a cache keyed by endpoint and credential together
(`targetKey`, `otel.ts:207-212`) grows without bound once the credential rotates. Key it by
endpoint alone and hold the credential it was built with; rebuild the entry when the resolved
credential differs. An evicted exporter is left to finish any in-flight export and is not shut
down eagerly, so a rotation cannot cancel a request already on the wire.

Two properties follow, and they are the reason no ritual is needed anywhere:

1. **A 12 hour turn exports with a credential minted minutes earlier**, because the watchdog has
   been re-minting the whole time and the export reads the current value.
2. **Nothing inside the sandbox is involved.** There is no file to refresh, no hook to fire, no
   token to scope, and no TTL to tune.

### Relationship to the write-only secret grant

The run credential can carry the `secret-resolve` grant, which lets the platform runtime read
write-only vault values in plaintext (`api/oss/src/middlewares/auth.py`, `SECRET_RESOLVE_GRANT`;
enforcement in `api/oss/src/apis/fastapi/vault/router.py`). That grant travels forward across
every credential refresh (`api/oss/src/apis/fastapi/access/router.py`, `_run_credential_grants`),
so a leaked grant-bearing token is not bounded by its 15 minute life. Anything that can hold it
can renew it.

Under this design the runner is the only holder. The runner is trusted, runs outside every
sandbox, and already uses that credential for session claims, mount signing, the turns ledger,
and record ingest. Nothing new is exposed.

Under `main`, and under the rejected pull request 6135, that is not true. On `main` the 0600
`.otlp-auth` file inside a local Pi sandbox holds the general run credential, grant and all. Pull
request 6135 narrowed the sandbox copy to a path-confined trace-ingest token, which was a real
improvement, but it still put a credential in there. This design removes the file entirely, so
the grant question stops existing on the runner-driven sandbox path.

## Batching, flush, and failure

Unchanged from today, and that is deliberate. `TraceBatchProcessor` buffers a trace's spans and
exports them in one OTLP batch, because Agenta computes rolled-up token and cost metrics per
ingest batch and a split trace loses the root aggregation (`otel.ts:288-296`).

Order of operations at the end of a turn, in `run-turn.ts`:

1. Stop the tool relay (already there, `run-turn.ts:1147`).
2. Final drain of the record file, and materialize everything left.
3. Read the run usage file and set it on the run (already there, `run-turn.ts:1149-1156`).
4. `finish()` closes any span still open, then `await flush()`.

Failure handling:

- **A record fails to parse.** Skip the line, count it, continue. One bad line never costs the
  rest of the tree.
- **A record is unknown, oversized, or has an unknown version.** Same: skip and count.
- **The drain read fails.** Best effort, same as `readRunUsage` today
  (`services/runner/src/engines/sandbox_agent/usage.ts:6-26`). The runner keeps the offset and
  retries on the next drain.
- **Zero records arrived for a turn that produced tool calls.** Not an error and not a fallback
  trigger, because the runner uploads the extension bundle into the sandbox on every run
  (`pi-assets.ts:668-690` for Daytona, `:590-608` for local) so version skew cannot happen. The
  runner logs a diagnostic through the existing export diagnostics path
  (`services/runner/src/tracing/export-diagnostics.ts`) and stamps a counter on the root, so the
  condition is visible rather than silent.
- **The export fails or is rejected.** Unchanged. `logExportProblem` reports it and the run does
  not fail (`otel.ts:340-372`).

The counters the runner stamps on the root span, all under `ag.meta.trace.*`: `records.applied`,
`records.dropped`, `records.orphaned`, `records.truncated`, `clock_clamped`. They cost one
attribute each and they are the difference between "the trace looks thin" and "the trace looks
thin and here is why".

## Budgets

Two, both enforced by the runner and both configurable through the runner's numeric env helper
(`services/runner/src/env.ts`), which clamps a bad override rather than trusting it.

| Name | Default | What it bounds |
| --- | --- | --- |
| `AGENTA_RUNNER_SPAN_RECORD_MAX_BYTES` | 262144 | One record. A larger line has its content-bearing attributes truncated, and `records.truncated` counts it. |
| `AGENTA_RUNNER_SPAN_RECORD_MAX_PER_TURN` | 5000 | Records materialized in one turn. Beyond it, records are counted in `records.dropped` and not materialized. |

The per-turn cap exists because a long turn buffers its whole tree in memory until the flush.
That is already true today on every runner-exported path, so the cap is a new bound on an old
behavior rather than a new constraint. The message array on a `chat` record is the large item,
and it repeats the whole context on every model call, exactly as the trace does today.

## Local and Daytona are the same

| Step | Local sandbox | Daytona sandbox |
| --- | --- | --- |
| Install the extension | `copyFileSync` into the run's agent dir (`pi-assets.ts:590-608`) | `sandbox.writeFsFile` into the sandbox's Pi dir (`pi-assets.ts:668-690`) |
| Pass the record path | `AGENTA_AGENT_SPAN_RECORD_PATH` in the daemon env | same variable in the Daytona `envVars` |
| Harness writes records | `appendFileSync` | `appendFileSync` |
| Runner resets the file | `localRelayHost().remove` (`relay.ts:264-292`) | `sandboxRelayHost().remove`, a `deleteFsEntry` daemon call (`relay.ts:294-351`) |
| Runner drains | `localRelayHost().read` | `sandboxRelayHost().read`, a `readFsFile` daemon call |
| Runner materializes, redacts, exports | identical | identical |

Everything above the `RelayHost` line is one code path with no placement branch. The only
placement-aware code is the `RelayHost` implementation that already exists and that the tool
relay already uses on both.

A consequence worth stating: **Daytona Pi traces get richer.** Today a Daytona Pi run is traced
from the ACP stream only, so its model call span is inferred. After this change it carries the
same observed provider, model, tokens, and cost that a local Pi run carries. The two placements
stop producing different traces for the same run.

## What the sandbox holds afterwards

| Thing | On `main` | On pull request 6135 | After this design |
| --- | --- | --- | --- |
| Agenta bearer token in a sandbox file | Yes, the general run credential, written once | Yes, a trace-ingest scoped token, rewritten every turn | No file at all |
| `AGENTA_AGENT_OTLP_AUTH_FILE` in sandbox env | Yes | Yes | Removed |
| `TRACEPARENT` in sandbox env | Yes on local Pi | Yes on local Pi | Removed |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` in sandbox env | Yes on local Pi | Yes on local Pi | Removed |
| OpenTelemetry SDK and OTLP exporter in the sandbox bundle | Yes | Yes | Removed |
| Network path from sandbox to Agenta's ingest | Used on local Pi | Used on local Pi | Never used |

On the runner-driven sandbox path, the number of Agenta credentials that cross the sandbox
boundary becomes zero.

## Trust: what a malicious sandbox can do with records

The relay directory is writable by the sandbox by design, and the code already reasons about a
process forging files in it (`services/runner/src/tools/relay-guard.ts:3-8`, on forged tool
execution records). So assume a prompt-injected agent writes arbitrary span records.

What it can do: put wrong or noisy spans into **its own run's trace**, in the caller's own
project.

What it cannot do, and why:

| Attack | Blocked by |
| --- | --- |
| Send spans to another project or another trace | The record carries no trace id and no endpoint. The runner picks both from the request. |
| Become the root span, or re-parent the tree | The runner creates the root itself and the record contract has no way to name it. `parent: null` means "under my root", never "replace my root". |
| Obtain a credential | There is none to obtain. |
| Exfiltrate through span content | The runner applies the run's redactor to every attribute at the export sink (`otel.ts:172-205`), which the current in-sandbox export path skips entirely. This design makes that path strictly better than today, not worse. |
| Exhaust runner memory or the OTLP endpoint | The per-record and per-turn budgets above. |
| Inject unknown attribute keys | The runner sets attribute keys itself from the record's typed fields. An unknown attribute in the record is not copied through. |

Compared to today, the sandbox trades the ability to hold a reusable Agenta bearer token for the
ability to write noise into a trace it already fully controls the content of. That is a clear
improvement.

## Decisions and the options behind them

### Decision 1: the harness sends structured records over the relay channel

| Option | Trade-off | Verdict |
| --- | --- | --- |
| **Structured span records over a file in the relay directory** | Reuses `RelayHost`, which already works on both placements. The runner sees typed data, so it can redact, cap, rename, and re-key without a sandbox change. Costs a new record contract and a new file. | **Chosen.** |
| A local OTLP collector inside the runner, with the extension exporting to it | Almost no new contract. But there is no network path from a Daytona sandbox back to the runner, which is precisely why Daytona already traces from the ACP stream (`extensions/agenta.ts:481-486`). It would need a tunnel and would give local and Daytona different architectures. | Rejected. Fails the one-path goal. |
| The extension writes serialized OTLP bytes and the runner forwards them | Smallest runner change. But the runner's redactor works on span attributes right before export (`otel.ts:172-205`), and opaque protobuf would bypass it. The sandbox would also own trace and span ids, which is the identity the record contract deliberately withholds. | Rejected. Bypasses redaction and hands identity to untrusted code. |
| A new ACP event type carrying span data | Conceptually the cleanest single channel. But the ACP vocabulary is fixed by the sandbox-agent adapters, not by us, so it needs an upstream change and a new adapter release before anything ships. | Rejected. Wrong dependency for the timeline. |
| Reuse the relay request and response protocol | Already has a poll loop and a sweep. But it is request and response with a runner-side authorization guard, built for tool execution. Span records are one way and fire and forget. | Rejected as a protocol. **The `RelayHost` transport under it is reused.** |

### Decision 2: keep Pi's hooks rather than deriving everything from the ACP stream

| Option | Trade-off | Verdict |
| --- | --- | --- |
| **Keep the hooks, change only their sink** | The trace keeps the provider request boundary, the real turn boundaries, the response model, the finish reason, and the per-call token and cost numbers. The extension shrinks, because the OpenTelemetry SDK leaves the bundle. | **Chosen.** |
| Delete the extension's tracing and derive spans from the ACP stream | The simplest possible change: one span builder, one path, nothing new to write. But `chat <model>` becomes inferred, per-call usage is lost where the ACP stream does not report it, and the local Pi trace gets worse than it is today. | Rejected. Loses the richness the design is meant to preserve. |
| Keep both, and reconcile them at the runner | Would give a safety net when records go missing. But reconciling two span sources for the same turn means deduplication rules nobody can verify by reading, and double counted tokens whenever the rules are wrong. | Rejected. Complexity with no failure mode it actually protects against, since the extension bundle ships with the runner on every run. |

### Decision 3: records describe finished units, not started ones

| Option | Trade-off | Verdict |
| --- | --- | --- |
| **One record per finished unit, carrying both timestamps** | A record is written once and never amended. The reader has no state machine. A crash loses only the units that had not finished. OpenTelemetry accepts explicit start and end times, so a late record still produces a correct span. | **Chosen.** |
| A start record and an end record per unit | Would let the runner see work in flight. But nothing is exported until the turn ends anyway, so in-flight visibility buys nothing, and it doubles the record count and adds pairing logic and orphan handling. | Rejected. Cost with no benefit at this batching model. |

### Decision 4: the export credential is resolved at export time from the runner's watchdog

| Option | Trade-off | Verdict |
| --- | --- | --- |
| **A getter on the export target, backed by `AliveWatchdog.credential()`** | Fixes long turns for every placement, including the ones that never involved a sandbox. Uses a refresh loop that already exists and is already trusted for the turns ledger. About twenty lines. | **Chosen.** |
| A longer-lived token scoped to the ingest path | This is what pull request 6135 built. It moves the ceiling from 15 minutes to 2 hours and adds a token type, a scope enforcement path, a response field, three SDK fields, and a wire field. A 12 hour turn still fails. | Rejected. New permanent surface that does not solve the stated case. |
| The runner refreshes the token itself just before export | Would work, but it adds a network call on the export path, which then has its own failure mode at the worst moment. The watchdog already keeps the value fresh in the background. | Rejected. Same result, worse failure timing. |

### Decision 5: the runner owns the record file's per-turn reset

| Option | Trade-off | Verdict |
| --- | --- | --- |
| **The runner removes the file and resets its offset when it dispatches a turn** | One owner for the turn boundary, and it is the trusted side. Bounds sandbox disk. Each turn's records are self contained. Costs one `RelayHost.remove` per turn. | **Chosen.** |
| The harness truncates on its first write of a turn | Mirrors how the usage file is overwritten today. But it puts the boundary in untrusted code, and a harness that gets it wrong silently mixes two turns' spans. | Rejected. |
| Never reset, and carry a read offset across the whole session | No per-turn call at all. But the file grows for the life of a warm session, and a lost offset silently replays every earlier turn's spans. | Rejected. |

## What gets deleted

### From pull request 6135, all of it

**Runner.** `refreshOtlpAuthFile` (`pi-assets.ts:565-583`), `exportAuthorizationOf`
(`runtime-policy.ts:31-38`), `createOtlpAuthRefresher` (`extensions/agenta.ts:84-104`), the
`before_agent_start` bearer hook (`extensions/agenta.ts:500-511`), the per-turn refresh call
(`run-turn.ts:263-271`), the refresh call in `environment/runtime-lifecycle.ts:215-219`, and
`OtlpExporter.exportAuthorization` (`services/runner/src/protocol.ts:102`).

**API.** `TRACE_INGEST_SCOPE` and `_SCOPE_ALLOWED_PATHS`
(`api/oss/src/middlewares/auth.py:92`, `:97-99`), the scope enforcement block in
`verify_secret_token` (`auth.py:921-940`), the `scope` and `expires_in` parameters on
`sign_secret_token` (`auth.py:1014-1015`), `Allow.telemetry_credentials`
(`api/oss/src/apis/fastapi/access/router.py:27-40`), the mint block (`router.py:151-164`), and
`OTLPConfig.token_ttl_seconds` with `AGENTA_OTLP_TOKEN_TTL_SECONDS`
(`api/oss/src/utils/env.py:360-365`).

**SDK.** `TraceContext.export_authorization` (`sdks/python/agenta/sdk/agents/dtos.py:441`) and
its wire emission (`dtos.py:465-471`), `WireOtlpExporter.export_authorization`
(`sdks/python/agenta/sdk/agents/wire_models.py:196-198`),
`TracingContext.telemetry_credentials` (`sdks/python/agenta/sdk/contexts/tracing.py:16`), the
`telemetry_credentials` keyword on the four `running.py` entry points, the two reads in
`decorators/routing.py:631,659`, and the tuple return from `get_credentials`
(`sdks/python/agenta/sdk/middlewares/routing/auth.py:77`) together with the dict-shaped cache
value.

**Tests.** `services/runner/tests/unit/otlp-auth-per-turn.test.ts`,
`sdks/python/oss/tests/pytest/unit/test_auth_middleware_credentials.py`, the scope cases added
to `api/oss/tests/pytest/unit/middlewares/test_auth_secret_token.py`, the `exportAuthorization`
lines in `services/runner/tests/unit/wire-contract.test.ts` and the Python wire contract test,
the golden entry in `sdks/python/oss/tests/pytest/unit/agents/golden/run_request.pi_core.json`,
the masking case in `test_dtos_secret_repr.py`, and the fixture change in
`services/oss/tests/pytest/unit/agent/test_subscription_status.py`.

### From pull request 6135, kept

The `iat` claim on every Secret token (`auth.py:1044`) and the `except HTTPException: raise`
guard that stops a 401 becoming a 500 (`auth.py:973-976`). Both are independent of the credential
split. `plan.md` lands them first, on their own.

The exporter cache re-key (`otel.ts:217-233`) is independently required by the credential getter,
so an equivalent change stays, restated to key by endpoint and hold the credential it was built
with.

### Already on `main`, now dead

**The in-sandbox exporter.** `createAgentaOtel`'s export half in
`services/runner/src/tracing/otel.ts:675-925` becomes a record writer with the same hooks and no
OpenTelemetry dependency. The extension's `otel.flush()` on `agent_end`
(`extensions/agenta.ts:513-514`) goes away.

**The credential file.** `writeOtlpAuthFile` and `readOtlpAuthFile`
(`pi-assets.ts:552-563`, `extensions/agenta.ts:66-81`), the environment variable
`AGENTA_AGENT_OTLP_AUTH_FILE` (`pi-assets.ts:491-496`), `otlpAuthFilePath` on the run plan and
in `runtime-lifecycle.ts:215`, and the `<relayDir>.otlp-auth` file itself.

**The sandbox's tracing environment.** `TRACEPARENT` and
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` in `buildPiExtensionEnv` (`pi-assets.ts:488-492`), and the
`hasTracing` gate derived from them (`extensions/agenta.ts:444-446`), replaced by a gate on the
record path variable.

**The `emitSpans` boolean.** `emitSpans: !plan.isPi || plan.isDaytona` (`run-turn.ts:293`) and
the option it feeds (`otel.ts:1153-1159`) become a source selector:

```ts
spanSource: plan.isPi ? "records" : "acp",
```

`"records"` means the runner builds the tree from span records and still builds the `AgentEvent`
log from the ACP stream. `"acp"` means the runner builds both from the ACP stream, which is what
Claude and Codex do today. The third state, "nobody builds spans in the runner", disappears
entirely, and with it the reason the two placements ever differed.
