# Status

**Phase: implementation started.**

Last updated: 2026-08-22.

## Decisions

- Pi remains the source of Pi spans.
- The runner is the only external exporter.
- Local and Daytona use one file-spool protocol and one consumer state machine.
- The payload is raw standard OTLP protobuf, not a custom Agenta DTO.
- Pi receives per-turn propagation and capture policy, but no endpoint or credential.
- The runner uses a renewable credential lease, so no two-hour telemetry token sets the session
  limit.
- Pi ACP span reconstruction is disabled in both placements after cutover.
- The existing tool relay supplies transport precedent, but telemetry and tools keep separate
  protocol directories and authorization rules.
- General credential wire cleanup is a follow-up compatibility slice, not a prerequisite for the
  trace fix.
- Trace export remains best-effort and bounded.
- No feature flag or parallel long-lived Pi export mode will be added.
- Work starts with two focused PRs: runner export-time authorization, then API issued-at plus 401 preservation.

## Approved Fable review constraints for the remaining work

- Pi redacts its own spans in every placement. One shared deny-set builder serves Pi and the runner, includes both mount credential pairs, and the extension uses an explicit always-on mode.
- Cancellation still produces a trace. Pi publishes what it has; when no batch arrives, the runner emits the minimal error and usage fallback span. Do not add periodic partial batches because ingest rollups depend on one complete batch.
- Keep the existing OTel exporter behavior and add only a thin raw-bytes post for spooled batches.
- Add a telemetry-only byte host beside the relay directory. Do not rewrite the tool relay.
- Allow a bounded sequence of raw protobuf files per turn, written by temporary-sibling rename and serialized parent-first.
- Add a runner-owned size cap below the API 10 MB default, teardown and turn-start sweeps, unread-control diagnostics, and a consumer symbol in the extension bundle leak gate.
- Pin ProtobufTraceSerializer as a direct dependency and replace the serializer spike with a fixture test.
- Reset and test per-turn Pi usage for warm sessions.
- The accepted trust boundary is project-scoped forwarding of sandbox-authored protobuf. No custom DTO, trace parser, deduplication layer, compatibility flag, or feature flag is added.
- Release-gate coverage must include trace structure, redaction, local Pi, Daytona Pi, local Claude, and a turn held beyond one credential lifetime.

PR #6217 implements the first approved prerequisite. PR #6218 carries the independent Secret-token issued-at and 401 correctness fixes.

## Current evidence

- Main's access router already re-mints renewable short-lived credentials.
- Main's runner already refreshes credentials during session-owned turns.
- Main's Pi extension already creates the desired native span tree.
- Main's relay already supports local and Daytona through host adapters with atomic files, stale
  sweep, watch/poll fallback, and delete-on-pickup.
- Main's OTLP ingest accepts the same standard protobuf body the Pi extension can spool.
- PR #6135 extends the lifetime and refreshes only authorization. It does not remove the lifetime
  coupling or unify local and Daytona export.

## Open questions

1. Should the first release parse OTLP in the runner for trace-ID hardening, or rely on the bounded
   current-channel capability plus API parsing? The recommendation is to ship without a second
   semantic parser unless threat review requires it.
2. What compatibility window is required before moving the general credential from the legacy
   telemetry header into `platform.headers.authorization`?
3. If PR #6135 merges first, has any other feature adopted its token-scope machinery? Remove only
   code that has no remaining owner.

## Blockers

None. The two prerequisite correctness PRs are open and the serializer seam is decided.

## Next action

Review and land PRs #6217 and #6218. Then pin the reviewed serializer dependency, add the parent-first fixture, and build the telemetry-only byte host.

