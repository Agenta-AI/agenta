# Status

**Phase: implementation complete; release-train verification in progress.**

Last updated: 2026-08-23.

## Decisions

- Pi remains the source of Pi spans.
- The runner is the only external exporter.
- Local and Daytona use one file-spool protocol and one consumer state machine.
- The payload is raw standard OTLP protobuf, not a custom Agenta DTO.
- Pi receives per-turn propagation, policy, attribution, and redaction-only values, but no endpoint
  or export credential.
- The runner uses one renewable platform credential lease for session and standalone turns, so no
  two-hour telemetry token sets the session
  limit.
- Pi ACP span reconstruction is disabled in both placements after cutover.
- The existing tool relay supplies transport precedent, but telemetry and tools keep separate
  protocol directories and authorization rules.
- General credential wire cleanup is a follow-up compatibility slice, not a prerequisite for the
  trace fix.
- Trace export remains best-effort and bounded.
- No feature flag or parallel long-lived Pi export mode will be added.
- PRs #6217 and #6218 landed the focused authorization and 401 prerequisites.

## Approved Fable review constraints for the remaining work

- Pi redacts its own spans in every placement. One shared deny-set builder serves Pi and the runner, includes both mount credential pairs, and the extension uses an explicit always-on mode.
- Cancellation still produces a trace. Pi publishes complete processor flushes; when no valid batch
  arrives, the runner emits one minimal error-and-usage fallback span.
- Keep the existing OTel exporter behavior and add only a thin raw-bytes post for spooled batches.
- Add a telemetry-only byte host beside the relay directory. Do not rewrite the tool relay.
- Allow a bounded sequence of raw protobuf files per turn, written by temporary-sibling rename and serialized parent-first.
- Add a runner-owned size cap below the API 10 MB default, teardown and turn-start sweeps, unread-control diagnostics, and a consumer symbol in the extension bundle leak gate.
- Pin ProtobufTraceSerializer as a direct dependency and replace the serializer spike with a fixture test.
- Reset and test per-turn Pi usage for warm sessions.
- The accepted trust boundary is project-scoped forwarding of sandbox-authored protobuf. No custom DTO, trace parser, deduplication layer, compatibility flag, or feature flag is added.
- Release-gate coverage must include trace structure, redaction, local Pi, Daytona Pi, local Claude, and a turn held beyond one credential lifetime.

PR #6217 and PR #6218 are merged prerequisites. PR #6223 implements the runner-owned Pi exporter,
the shared standalone/session credential lease, and target isolation.

## Current evidence

- The access router re-mints renewable short-lived credentials.
- The runner shares one proactive platform lease across session-owned and standalone turn paths.
- Pi creates the native span tree and publishes a bounded sequence of raw protobuf requests.
- Each completed processor flush publishes one file, up to four per turn. A fifth flush is dropped
  without overwriting any published sequence.
- Local and Daytona use the same consumer with atomic files, stale sweep, bounded reads, and
  delete-on-pickup.
- The consumer finishes bounded pickup before it sends any network request. Pickup acceptance,
  collector success, and missing-batch fallback remain separate outcomes.
- OTLP ingest accepts the standard protobuf body and recomputes cumulative metrics over stored
  split batches.
- Focused credential, session, Pi export, fallback, and orchestration tests are green.

## Open questions

1. What compatibility window is required before moving the general credential from the legacy
   telemetry header into `platform.headers.authorization`?

## Blockers

No implementation blocker. Merge and deployment remain owner-controlled release actions.

## Next action

Finish PR review and CI reconciliation, merge the v0.114 train, then rerun the release gate against
the combined release SHA before any explicitly approved preview deployment.
