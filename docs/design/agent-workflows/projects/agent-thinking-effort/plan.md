# Implementation plan

## Delivery shape

Use a linear GitButler stack for implementation, with each PR based on the branch directly below it. Keep the already-open dependency PR separate because it can merge independently.

### Dependency: Claude adapter

PR: [#5213](https://github.com/Agenta-AI/agenta/pull/5213)

Scope:

- upgrade local Claude ACP adapter to 0.58.1;
- maintain frozen pnpm resolution;
- prove live ACP effort option and a normal Claude run.

This does not upgrade Daytona.

### Phase 1: contract and Python propagation

Primary files:

- `sdks/python/agenta/sdk/utils/types.py`
- `sdks/python/agenta/sdk/agents/dtos.py`
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`
- `sdks/python/agenta/sdk/agents/utils/wire.py`
- `sdks/python/agenta/sdk/agents/wire_models.py`
- `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py`
- `sdks/python/agenta/sdk/agents/utils/ts_runner.py`
- Python schema, DTO, adapter, and golden wire tests

Work:

1. Add `LlmReasoning` and the effort literal union to the strict author schema.
2. Parse and runtime-validate first-class effort with legacy extras fallback and `none` to `off` normalization, including direct invoke paths that bypass catalog schema validation.
3. Add normalized reasoning effort to agent and harness DTOs.
4. Add optional `/run.reasoning.effort` to both Python wire definitions.
5. Omit the wire field for default.
6. Preserve existing default golden files and add explicit-effort fixtures.
7. Probe HTTP runners through `GET /health` and subprocess runners through a new `--info` command before emitting explicit reasoning. Cache success per backend instance.
8. Fail closed before `/run` when explicit effort is requested and the capability is missing, unknown, or unreachable; omission/default may use an old runner with legacy no-reset behavior during rollout.

Exit criteria:

- author schema accepts every supported literal and rejects typos;
- legacy values still execute through the normalized path;
- Pi and Claude adapters emit the same wire field;
- default requests remain byte-compatible;
- HTTP and subprocess capability negotiation have success, missing, timeout, and fail-closed explicit-effort tests.

### Phase 2: runner application and session semantics

Primary files:

- `services/runner/src/protocol.ts`
- `services/runner/src/version.ts`
- `services/runner/src/server.ts`
- `services/runner/src/cli.ts`
- new `services/runner/src/engines/sandbox_agent/reasoning.ts`
- `services/runner/src/engines/sandbox_agent.ts`
- `services/runner/src/engines/sandbox_agent/session-pool.ts`
- `services/runner/src/tracing/otel.ts` or the selected chat-span tracing seam
- runner unit and wire contract tests

Work:

1. Mirror the optional reasoning request shape.
2. Implement category discovery, strict explicit-value validation, apply, and adapter readback.
3. Apply effort immediately after model on create and resume.
4. Implement deterministic Pi and Claude default resets.
5. Add reasoning to the session configuration fingerprint.
6. Add concise error messages and requested/adapter-reported trace attributes with focused tracing tests.
7. Advertise `features.reasoningEffort: 1` in HTTP health and the subprocess `--info` response only when validation and application are present.

Exit criteria:

- model is always applied before effort;
- explicit unsupported or clamped values fail before prompt, with exact allowed values only when the adapter exposes them;
- default resets a prior explicit value;
- resumed sessions retain history and reapply configuration;
- changing only effort invalidates hot reuse;
- HTTP health and subprocess info return the same capability shape.

### Phase 3: UI control

Primary files:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts`
- package unit tests near the existing model/harness tests

Work:

1. Add the Effort selector below Model.
2. Implement parse and compose helpers that preserve unknown fields.
3. Represent Model default as omission.
4. Preserve explicit saved values across model/harness switches and show always-present model-support guidance.
5. Add concise help text about model-dependent availability.

Exit criteria:

- all values round-trip;
- selecting default removes only the effort override;
- unrelated model, connection, extras, and future reasoning keys survive edits;
- keyboard and screen-reader labeling match the existing model control.

### Phase 4: image parity and end-to-end QA

Work:

1. Upgrade or rebuild the Daytona sandbox image with compatible Claude and Pi adapters.
2. Run the matrix in `qa.md` locally and on Daytona.
3. Add replay tests for stable live regressions.
4. Update agent configuration and harness documentation.

Exit criteria:

- local and Daytona report the same adapter state and provider behavior for shared models;
- no regression in permission gates, tools, cancellation, or continuity;
- operator override precedence is documented.

## Suggested PR stack

1. `feat/agent-effort-contract`, base `big-agents`
2. `feat/agent-effort-runner`, base `feat/agent-effort-contract`
3. `feat/agent-effort-ui`, base `feat/agent-effort-runner`
4. `test/agent-effort-qa`, base `feat/agent-effort-ui`

Set each GitHub PR base to the branch below it even if independent file sets could be reviewed separately. This keeps the GitButler graph linear and each PR diff focused.

## Rollout

1. Merge adapter dependency PR.
2. Add `reasoningEffort: 1` to runner health/capability metadata when the runner can validate and apply the field.
3. Deploy the runner first. The service emits explicit `/run.reasoning` only after its configured runner reports that capability.
4. Release the UI only after the service-to-runner capability gate is active.
5. Do not use outer runner health to claim Daytona adapter support. After session creation, perform the same pre-prompt category/readback validation and keep Daytona parity unclaimed until the image matrix passes.
6. Monitor unsupported-value errors and legacy fallback usage.
7. Remove legacy read support only after stored-revision telemetry shows no remaining use.

Default omission is not behavior-neutral even though its payload is byte-compatible. Once the new runner is deployed, old producers that omit reasoning cause an explicit Pi/Claude reset. Include that change in release notes and verify existing self-managed agents do not rely on inherited global effort.

## Rollback

- UI rollback: hide the control; stored fields remain forward-compatible.
- Runner rollback: first disable the service capability gate so producers stop emitting explicit reasoning, then roll back the runner. An old runner otherwise ignores the unknown field silently.
- Adapter rollback: pin the previous package only if a critical protocol regression appears; effort stays disabled for Claude until restored.
- Daytona rollback: keep the feature disabled for that provider while local remains available.

