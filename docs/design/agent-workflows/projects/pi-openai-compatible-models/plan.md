# Implementation plan

## Phase 0: pin current behavior

Before changing behavior, add or update tests that describe the current boundaries:

- Pi rejects `deployment=custom`.
- A generic custom key with no provider family does not reach a canonical env variable.
- The custom endpoint already reaches the neutral `/run` payload.
- Claude maps an Anthropic custom gateway to `ANTHROPIC_BASE_URL`.
- `configFingerprint` changes when connection, model, or endpoint changes.
- credential epoch changes when the custom key rotates.

These tests distinguish intended changes from regressions.

## Phase 1: service normalization and capability validation

Primary files:

- `sdks/python/agenta/sdk/agents/platform/connections.py`
- `sdks/python/agenta/sdk/agents/handler.py`
- `sdks/python/agenta/sdk/agents/capabilities.py`
- SDK agent connection and composition tests

Work:

1. Normalize a provider-less `kind=custom` named connection to provider family `openai`.
2. Preserve an explicit known provider family for existing connections.
3. Route the normalized custom key through `OPENAI_API_KEY`.
4. Require a valid base URL for an explicit named custom connection. Replace silent URL dropping
   with a typed resolution error.
5. For named Agenta connections, defer provider acceptance until after resolve.
6. Add an authoritative resolved-pair validation helper. Allow Pi plus OpenAI plus custom; retain
   current direct and Claude combinations; reject arbitrary combinations.
7. Publish `custom` in Pi's deployment capabilities after the server can consume it.

Exit criteria:

- A named OpenAI-compatible connection resolves to provider `openai`, deployment `custom`, exact
  model, endpoint, and only `OPENAI_API_KEY`.
- Invalid endpoints fail before the runner call.
- Direct providers, self-managed connections, Claude, and unknown harnesses retain their current
  behavior.

## Phase 2: pure Pi model-config builder

Primary files:

- new `services/runner/src/engines/sandbox_agent/pi-model-config.ts`
- new focused unit test file

Work:

1. Define the internal `PiModelConfigPlan`.
2. Build it from the existing `AgentRunRequest` and resolved secrets.
3. Serialize the exact `models.json` shape with `api: "openai-completions"`.
4. Reject incomplete applicable requests with typed errors.
5. Prove that raw API keys never appear in the plan or serialized file.
6. Prove that standard Pi, subscription, and Claude requests return no plan.

Exit criteria:

- The pure builder has exhaustive unit coverage and no filesystem or sandbox dependencies.
- No wire field or protocol type changes.

## Phase 3: local Pi materialization

Primary files:

- `services/runner/src/engines/sandbox_agent/pi-assets.ts`
- `services/runner/src/engines/sandbox_agent.ts`
- Pi asset and orchestration tests

Work:

1. Make a model-config plan a reason to create an isolated managed Pi agent directory.
2. Write `models.json` before creating the ACP session.
3. Use restrictive permissions and atomic replacement.
4. Keep the environment key in `secrets`; write only `$OPENAI_API_KEY` to disk.
5. Make materialization failure terminal.
6. Reuse existing teardown for the throwaway directory.

Exit criteria:

- Local Pi advertises and selects `<connection-slug>/<model-id>`.
- The operator's shared Pi login directory is unchanged.
- A failed write cannot fall through to a default provider.

## Phase 4: Daytona parity

Primary files:

- `services/runner/src/engines/sandbox_agent/daytona.ts`
- `services/runner/src/engines/sandbox_agent.ts`
- Daytona unit and orchestration tests

Work:

1. Upload the exact config to `DAYTONA_PI_DIR/models.json` before `createSession`.
2. Overwrite a stale file on every cold environment acquisition.
3. Keep using `daytonaEnvVars` for the resolved API key.
4. Make upload failure terminal.
5. Verify config and credential fingerprint changes evict or cold-start rather than reuse a
   mismatched live session.

Exit criteria:

- The local and Daytona paths produce equivalent Pi-visible configuration.
- No personal subscription credential is uploaded.
- Reused sandboxes do not retain a prior custom provider configuration.

## Phase 5: UI terminology and selection behavior

Primary files:

- `web/packages/agenta-entities/src/secret/core/types.ts`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts`
- relevant entity UI tests

Work:

1. Rename the `custom` label to "OpenAI-compatible" without changing its stored value.
2. Default provider-less custom model selections to family `openai`.
3. Preserve explicit provider families and connection slugs.
4. Filter custom model options using both deployment and provider compatibility.
5. Keep the form limited to Chat Completions. Add concise helper text if needed.

Exit criteria:

- Existing vault records still load and edit.
- A new OpenAI-compatible connection is automatically selected after creation.
- Pi displays it after the capability update.
- Claude and other harnesses do not gain incompatible choices.

## Phase 6: integration and live QA

1. Run the Python SDK agent suite.
2. Run runner unit tests and typecheck.
3. Run affected web package unit tests and `pnpm lint-fix` before any commit.
4. Exercise a fake OpenAI-compatible HTTP server through the service-to-runner path.
5. Verify local Pi against one real compatible endpoint.
6. Verify Daytona against an endpoint reachable from Daytona.
7. Verify a blocked loopback endpoint fails clearly by default.
8. Verify a trusted self-hosted local endpoint with the existing insecure-egress opt-in.
9. Re-run Claude direct and custom-gateway smoke cases.

## Suggested review slices

The safest review order is:

1. Service normalization, validation, and capabilities.
2. Pure runner builder plus local materialization.
3. Daytona materialization.
4. UI label and picker behavior.
5. Live QA evidence.

The slices can share one design but should remain separately reviewable. Do not enable Pi's custom
deployment capability until the runner slice that consumes it is available in the same release
line.

