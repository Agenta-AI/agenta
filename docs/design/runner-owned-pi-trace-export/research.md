# Research

Research was performed against `origin/main` at commit
`53717db55ec9311887be6fe86a67b2007590b6f3` and PR #6135 at
`f20bede3cb2841234a8d641b273d9b312cb80dce` on 2026-08-22.

## Verified current behavior

### Access exchange and middleware

- `api/oss/src/apis/fastapi/access/router.py`, `AccessRouter.check_permissions`, always returns a
  freshly signed short-lived `Secret` credential after permission checking.
- `sdks/python/agenta/sdk/middlewares/routing/auth.py`, `get_credentials`, calls that endpoint for
  the `run_service` action and caches the result for one minute by default.
- `sdks/python/agenta/sdk/agents/tracing.py`, `trace_context`, captures the active W3C propagation
  values, Agenta OTLP endpoint, caller credential, and capture policy.
- `sdks/python/agenta/sdk/agents/dtos.py`, `TraceContext.telemetry_to_wire`, puts the caller
  credential under `telemetry.exporters.otlp.headers.authorization`.
- `services/runner/src/server.ts`, `runCredential`, and
  `services/runner/src/engines/sandbox_agent/runtime-policy.ts`, `runCredential`, treat that field
  as the general runner-to-platform credential, not only as exporter authorization.

This explains why replacing the existing field with a trace-only token is unsafe. The field is
misnamed by location, but its current behavior carries broad runner authority.

### Runner credential refresh

- `services/runner/src/sessions/auth.ts`, `refreshCredential`, reuses
  `/access/permissions/check` to exchange a still-valid credential for a fresh one.
- `services/runner/src/sessions/alive.ts`, `startAliveWatchdog`, stores the credential mutably and
  refreshes it during a long session-owned turn.
- `services/runner/src/engines/sandbox_agent/run-turn.ts` already accepts a `credential()` closure
  for runner platform calls during the turn.

The reusable piece is therefore a runner-owned renewable credential lease. Trace export should
read from that lease at send time. It should not capture one token at process or turn start.

### Pi spans versus ACP reconstruction

- `services/runner/src/tracing/otel.ts`, `createAgentaOtel`, subscribes to Pi's native
  `before_agent_start`, `agent_start`, `context`, `turn_start`, `before_provider_request`,
  `message_end`, `tool_execution_start`, `tool_execution_end`, `turn_end`, and `agent_end` events.
- Those events create the agent, turn, LLM, and tool spans and record the real provider, model,
  inputs, outputs, token usage, and cost.
- `createSandboxAgentOtel` reconstructs a similar tree from ACP updates. ACP does not carry all of
  Pi's per-provider details and exact cost data.
- `run-turn.ts` currently sets `emitSpans: !plan.isPi || plan.isDaytona`. Local Pi therefore uses
  Pi-native spans, while Daytona Pi uses ACP reconstruction.
- `services/runner/src/extensions/agenta.ts` exports directly only when tracing is enabled. Daytona
  uses the extension for usage writeback but not for direct trace export.

The new design should set runner ACP span emission off for Pi in both placements. It should make
Pi-native export available in Daytona through the spool instead of direct networking.

### Warm-session tracing state

- `services/runner/src/engines/sandbox_agent/pi-assets.ts`, `buildPiExtensionEnv`, writes
  `TRACEPARENT`, OTLP endpoint, capture policy, skills, and the auth-file path into the environment
  created for the Pi process.
- `services/runner/src/extensions/agenta.ts` reads those values when the extension factory runs and
  creates one `AgentaOtel` object.
- A warm environment reuses that Pi process across later `/run` requests.

PR #6135 refreshes authorization before each `agent_start`, but the other tracing values remain
process-scoped. A proper per-turn contract must refresh propagation and policy together.

## Existing cross-placement transport precedent

`services/runner/src/tools/relay.ts` defines one runner-side relay loop with two host adapters:

- `localRelayHost` uses Node filesystem operations.
- `sandboxRelayHost` uses Daytona's sandbox filesystem API.

The relay already implements the important transport mechanics:

- atomic publication through write-to-temp and same-directory rename;
- suffix-based discovery that ignores temporary files;
- delete-on-pickup;
- stale-file sweep before a warm turn;
- local file watching and Daytona watch or poll behavior;
- polling fallback and bounded stop/drain behavior;
- a runner-side authorization check because the directory is sandbox-writable.

`services/runner/src/engines/sandbox_agent/usage.ts` independently proves that one logical read can
work through local filesystem access or Daytona's `readFsFile` API.

The current `RelayHost` is text-specific because the tool protocol is JSON. Daytona's filesystem
API already returns bytes, and other runner paths write `Buffer` values. The reusable change is to
factor a binary runtime-file host below the tool relay. Tool relay can decode JSON on top; telemetry
can preserve protobuf bytes.

## Standard OTLP payload

- The runner pins `@opentelemetry/exporter-trace-otlp-proto` at `0.220.0`.
- The lockfile includes `@opentelemetry/otlp-transformer` at the same version.
- The API parses an OTLP `ExportTraceServiceRequest` protobuf in
  `api/oss/src/apis/fastapi/otlp/opentelemetry/otlp.py`.
- `api/oss/src/apis/fastapi/otlp/router.py` accepts `application/x-protobuf` and rejects bodies over
  the configured `AGENTA_OTLP_MAX_BATCH_BYTES` limit.

The first implementation step must prove the supported serializer API for the pinned package and
pin it as a direct dependency if the extension imports it. The design must not copy generated OTLP
types or invent a parallel span schema.

## What PR #6135 adds

PR #6135 keeps local Pi as the network exporter and adds:

- an export-only token with a two-hour lifetime;
- token scope enforcement in API auth middleware;
- a second `telemetry_credentials` value in routing middleware state;
- `export_authorization` in the SDK DTO;
- `exportAuthorization` on the runner wire;
- a per-turn auth-file rewrite for the Pi extension.

Those changes improve least privilege relative to giving Pi the general credential, but they retain
a fixed token-lifetime dependency and a local-only direct-export path. The runner-owned design does
not need the second token or the added wire field because Pi receives no credential at all.

## Related work

- [PR #6109](https://github.com/Agenta-AI/agenta/pull/6109) added trace-export diagnostics. Keep and
  extend those diagnostics.
- [Issue #6153](https://github.com/Agenta-AI/agenta/issues/6153) records the warm-session 401
  incident.
- `docs/design/agent-workflows/documentation/adapters/pi.md` documents Pi self-instrumentation and
  exact usage.
- `docs/design/agent-workflows/documentation/adapters/claude-code.md` documents runner-side ACP
  reconstruction for a harness that does not self-instrument.

