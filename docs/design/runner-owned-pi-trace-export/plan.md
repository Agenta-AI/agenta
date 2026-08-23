# Implementation plan

Each phase should land green and keep trace failures best-effort. The first two phases establish
the reusable substrate. The third phase switches Pi. The remaining phases remove temporary
contracts and prove long-session behavior.

## Immediate prerequisite PRs

1. Runner export-time authorization (own PR): replace the captured authorization value with a provider backed by the credential getter that the alive watchdog already refreshes. Resolve it at flush time, and rebuild the endpoint cache entry when the resolved credential changes without interrupting an export already in flight. Acceptance: a credential rotated after tracing starts is used by export; short and non-session runs preserve current behavior; third-party unauthenticated collectors, diagnostics, and per-run target isolation remain correct.
2. API Secret-token correctness (own small PR): add issued-at to every Secret JWT and re-raise HTTPException before the verify_secret_token catch-all. Acceptance: issued-at and expiry describe the configured lifetime; intentional, expired, and malformed authentication failures remain 401; unexpected failures remain 500. This adds no telemetry scope, export-only token, or longer TTL.

These prerequisites do not change Pi span production. The Pi-owned span and runner-owned export cutover follows below.

## Approved review changes to the remaining sequence

The decisions in review.md supersede conflicting details in the older phase text below. The implementation order after the two prerequisite PRs is:

1. Pin the public ProtobufTraceSerializer seam and prove parent-first raw-byte round trip in a fixture test. This replaces the serializer spike.
2. Add a telemetry-only binary file host in a sibling of the relay directory. Do not refactor the tool relay.
3. Add the per-turn control file and bounded multi-file spool. Include both mount credential pairs, one shared sandbox-visible redaction builder, explicit always-on Pi redaction, a runner size limit below the API 10 MB default, atomic sibling rename, start and teardown sweeps, and an unread-control diagnostic.
4. Preserve cancellation traces: Pi publishes what it has and the runner emits a minimal error and usage fallback when no batch arrives. Keep one complete batch rather than periodic checkpoints.
5. Cut local and Daytona Pi over together without a feature flag. Add the spool consumer to the bundle leak gate and reset per-turn Pi usage for warm sessions.
6. Remove rejected token-scope and export-only DTO surfaces if any remain, then add release-gate trace and trace-long journeys for local Pi, Daytona Pi, and local Claude.

The runner forwards raw standard OTLP protobuf under the current project credential. The accepted trust boundary and idempotent storage behavior are documented in review.md; do not add a custom DTO, a second semantic parser, or a deduplication layer.

## Phase 0: pin the serializer and prove the byte contract

Pin the OpenTelemetry transformer directly at the reviewed version and use its public ProtobufTraceSerializer.serializeRequest API. Add a focused fixture test that serializes a parent-first ReadableSpan batch and proves trace ids, parent ids, attributes, events, status, resources, and raw-byte handling survive. Confirm agent_end drain ordering and keep the consumer symbol out of the extension bundle. There is no serializer discovery spike and no copied protobuf definition.

## Phase 1: add a telemetry-only byte host

Add only the local and Daytona byte operations the telemetry spool needs. Use a telemetry directory beside the existing relay directory, keyed the same way, and create it even when tools are absent. Reads return bytes, writes accept bytes, and publication uses a temporary sibling plus same-directory rename. Add exact local and fake-Daytona binary round-trip tests, size-before-read checks, start and teardown sweeps, and leftover diagnostics. Do not modify or rebuild the tool relay.

## Phase 2: reuse runner export behavior for spooled bytes

PR #6217 already resolves the live platform credential at export time and keeps exporter rotation safe. For spooled batches, retain the existing timeout, missing-credential rule, diagnostics, target attribution, and best-effort failure behavior. Add one thin raw-bytes post path that resolves the same current authorization. Do not create a second lease, a general export-sink rewrite, a 401 retry protocol, or a third-party collector refresh path.

Tests cover current-credential use, missing Agenta credentials, unauthenticated third-party collectors, failed sends, and independent run attribution.

## Phase 3: add the Pi per-turn control and OTLP spool

Files:

- Add a dependency-free control protocol module, for example
  `services/runner/src/tracing/pi-spool-protocol.ts`, safe to bundle into the Pi extension.
- Add `services/runner/src/tracing/pi-file-exporter.ts` for Pi-side serialization and atomic
  publication.
- Add `services/runner/src/tracing/pi-spool-consumer.ts` for runner-side pickup and forwarding.
- Update `services/runner/src/extensions/agenta.ts` to read the control file on every
  `before_agent_start`, mutate all per-turn tracer configuration, and publish on `agent_end`.
- Update `services/runner/src/tracing/otel.ts` to let Pi use the file batch transport without
  changing its lifecycle hooks.
- Update `services/runner/src/engines/sandbox_agent/pi-assets.ts` to supply only the stable control
  path and spool configuration. Remove the endpoint and auth-file environment variables from Pi.
- Update `services/runner/src/engines/sandbox_agent/run-turn.ts` to start the spool consumer,
  publish control, run the prompt, then perform a bounded drain before returning.
- Update `services/runner/src/engines/sandbox_agent/runtime-contracts.ts` and environment lifecycle
  types for the new per-turn consumer. Remove `otlpAuthFilePath`.

Runner turn ordering:

1. Start consumer and finish stale sweep.
2. Atomically publish control file.
3. Send or resume the Pi prompt.
4. Stop tool relay after prompt as today.
5. Resolve Pi usage as today.
6. Drain the expected telemetry batch with a short bound.
7. Finish runner event handling and return the agent result.
8. Stop the consumer in `finally` on every path.

Pi changes:

- `createAgentaOtel` keeps all existing native event hooks.
- `before_agent_start` replaces `traceparent`, baggage, capture policy, session/turn metadata, and
  channel state from the current control file.
- Per-turn usage counters reset at the same boundary. Session-wide totals, if needed elsewhere,
  remain separate.
- `agent_end` publishes one complete standard OTLP protobuf batch and then writes usage output.

Tests:

- Control parsing, unknown version, missing file, malformed channel, and read-once deletion.
- Atomic publication never exposes a temporary or partial file.
- Exact binary round trip through local and fake-Daytona hosts.
- Stale previous-turn file is swept and cannot satisfy the next turn.
- Wrong channel is ignored.
- Oversized and duplicate files are rejected and removed.
- Missing batch times out without failing the agent result.
- Warm turn two uses its own traceparent and capture policy, not turn one's.
- Pi spans preserve native provider, model, tool, usage, cost, parent IDs, and content-capture rules.

## Phase 4: switch both Pi placements to one path

In `run-turn.ts` change Pi span ownership to:

```ts
emitSpans: !plan.isPi
```

Enable the Pi spool in both local and Daytona environment plans. Remove the Daytona statement that
the extension is usage-only. The resulting behavior is:

| Harness | Placement | Span producer | External exporter |
|---|---|---|---|
| Pi | Local | Pi extension | Runner |
| Pi | Daytona | Pi extension | Runner |
| Claude, Codex, Agenta | Local or Daytona | Runner ACP tracer | Runner |

Never enable direct Pi export and spool export together. Local and Daytona cut over atomically through the same runner and image release; do not add a feature flag or a second long-lived mode.

Tests:

- One table-driven orchestration suite runs the same Pi spool assertions for local and Daytona
  hosts.
- Assert the ACP tracer emits no duplicate Pi agent, LLM, turn, or tool spans in either placement.
- Assert non-Pi behavior remains unchanged.
- Assert runner error spans still export without replacing Pi's batch.

## Phase 5: remove the PR #6135 workaround contract

If PR #6135 has not merged, replace its implementation and keep only generally useful diagnostics.

If it has merged, remove:

- export-only token minting and the two-hour TTL;
- trace-ingest token scope enforcement added solely for this path;
- `request.state.telemetry_credentials`;
- `TraceContext.export_authorization`;
- `WireOtlpExporter.exportAuthorization`;
- runner `exportAuthorizationOf` compatibility logic;
- per-turn OTLP auth-file refresh and Pi auth-file reader.

Do not remove a token-scope facility if another merged feature has adopted it. In that case, remove
only this feature's dependency on it and document the remaining owner.

Update SDK golden requests, DTO repr tests, runner wire-contract tests, API middleware tests, and
comments that describe local Pi as a direct exporter.

## Phase 6: clean the general credential wire

Treat this as a separate compatibility slice after runner-owned export is stable.

1. Add `platform.headers.authorization` to Python wire models and runner protocol types.
2. Resolve it into `PlatformCredentialLease` at the server boundary.
3. Dual-read in the runner and dual-write in the SDK for the supported version window.
4. Move all runner platform callers to the lease.
5. Remove the legacy general credential from `telemetry.exporters.otlp.headers` after compatibility
   is proven.

This phase fixes the strange DTO ownership without coupling that cleanup to the trace outage fix.

## Phase 7: documentation and release gate

- Update Pi and Daytona adapter documentation to say Pi produces spans and the runner exports them.
- Update runner README security notes to include the bounded telemetry spool.
- Add the long-session cells from [qa.md](qa.md) to the agent release gate or its runner runtime
  fixtures.
- Link issue #6153 and close it only after local and Daytona warm-session traces are visible in the
  target project.

## Recommended PR stack

Use a linear GitButler stack and set each GitHub PR base to the branch below it:

1. `runner-runtime-file-host`
2. `runner-credential-lease-export-sink`
3. `pi-otlp-file-spool`
4. `pi-spool-local-daytona-cutover`
5. `remove-pi-export-token-workaround`
6. `runner-platform-credential-wire` as a follow-up after compatibility review

The first four branches are the functional path. Branch five depends on whether PR #6135 merged.
Branch six is cleanup and should not delay the cutover.

