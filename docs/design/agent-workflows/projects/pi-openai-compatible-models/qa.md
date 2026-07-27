# QA plan

## What was exercised (2026-07-15)

The plan below is the intended coverage. The result of running it:

- SDK agents suite: 669 passed. Covers the resolution, capability, and wire cases below.
- Runner suite: 1190 passed, plus the wire golden fixtures. Covers the pure builder, local
  assets, Daytona assets, and session-reuse cases below.
- Frontend entity-ui suite: 208 passed. Covers the frontend cases below.
- Live acceptance ran on the EE dev stack on 2026-07-14 and 2026-07-15. The happy path passed
  local and on Daytona: the custom endpoint reply was proven, the `models.json` contents were
  verified, and `auth.json` isolation was verified. The 422 fail-loud paths passed. Standard Pi
  and Claude regression runs passed. The UI click-through passed.

The Playwright `model-hub.ts` strings are updated but a live Playwright run is still outstanding
(see [open-issues.md](open-issues.md)).

A replay regression test is being added from the recorded happy-path `/run` pair (the capture
lives in the session scratchpad). It pins the SDK and runner behavior against the recorded runner
response so the custom-endpoint path replays without a live LLM. See the `agent-replay-test` skill
for the capture-and-redact flow.

## Service and SDK unit coverage

### Resolution

- `kind=custom`, named connection, unknown bare model, API key, public HTTPS URL:
  resolves provider `openai`, deployment `custom`, env only `OPENAI_API_KEY`, exact model, endpoint,
  and credential mode `env`.
- Explicit provider `openai` produces the same result.
- Explicit provider `anthropic` remains Anthropic and does not receive `OPENAI_API_KEY`.
- Two named custom connections with the same model select by connection slug.
- Missing named connection fails loudly.
- Missing base URL on a named OpenAI-compatible connection fails loudly.
- Blocked HTTP, loopback, link-local, private, and metadata URLs fail loudly.
- API keys never appear in error strings, reprs, or non-secret wire fields.

### Capabilities

- Pi accepts resolved `(openai, custom)`.
- Pi rejects `(anthropic, custom)` in this phase.
- Pi continues accepting current direct providers and subscription modes.
- Claude continues accepting its current Anthropic direct/custom path.
- Claude rejects `(openai, custom)`.
- Unknown harnesses remain closed.
- Direct callers cannot bypass post-resolve pair validation.

### Wire

- Existing golden fixtures remain byte-identical unless their test input explicitly includes a
  resolved custom connection.
- A custom connection continues to emit the existing `provider`, `connection`, `deployment`,
  `endpoint`, `credentialMode`, and `secrets` fields only.
- No `api`, `protocol`, `modelsJson`, or Pi-specific wire field appears.

## Runner unit coverage

### Pure builder

- Applicable Pi request produces one provider keyed by connection slug.
- Output uses `openai-completions` and `$OPENAI_API_KEY`.
- Arbitrary model IDs and characters valid in model IDs round-trip unchanged.
- Raw secret value does not appear in the plan or serialized JSON.
- Missing slug, endpoint, model, env credential, or wrong credential mode fails.
- Standard direct Pi, self-managed Pi, Claude, and unknown harness requests do not produce a Pi
  custom config.

### Local assets

- Managed custom run creates a throwaway Pi directory even without skills or prompt overrides.
- `models.json` has mode `0600` and valid JSON.
- Existing unrelated shared files are not modified.
- Materialization precedes ACP session creation.
- Write failure aborts the run.
- Teardown deletes the throwaway directory.

### Daytona assets

- Upload targets `${DAYTONA_PI_DIR}/models.json`.
- Upload precedes ACP session creation.
- Existing file is replaced rather than merged.
- Upload failure aborts the run.
- The sandbox env contains only the resolved provider key plus existing required Pi variables.
- No runner subscription login is uploaded.

### Session reuse

- Changing connection slug, base URL, model, provider, or deployment changes config fingerprint.
- Rotating the API key changes credential epoch.
- Either mismatch prevents reuse of a parked incompatible environment.
- An unchanged request can still use the current keepalive path.

## Frontend unit coverage

- `PROVIDER_LABELS.custom` renders "OpenAI-compatible".
- Stored and submitted kind remains `custom`.
- Selecting a bare model from a custom connection writes provider `openai` and the exact slug.
- Selecting an explicitly family-qualified model preserves that family.
- Switching from an unrelated prior provider does not leak the prior provider into the new custom
  selection.
- Pi shows compatible custom connections when its custom deployment is enabled.
- Claude does not show an OpenAI-compatible bare-model connection.
- Existing explicit Anthropic gateway behavior remains covered.

## Integration coverage

Use a deterministic fake OpenAI Chat Completions endpoint that records the request host, path,
model, and authorization presence without recording the secret.

Assert:

- the service resolves exactly one named vault connection;
- the runner calls the configured host, not `api.openai.com`;
- the request model equals the configured custom model;
- a second connection with the same model ID routes to its own host;
- an invalid model fails instead of using a harness default;
- rotating the key causes a cold configuration refresh.

## Live acceptance matrix

| Runner | Endpoint | Expected |
| --- | --- | --- |
| Local | Public HTTPS OpenAI-compatible | Pass |
| Daytona | Public HTTPS OpenAI-compatible | Pass |
| Local trusted self-host | HTTP/private with opt-in | Pass when reachable |
| Local default security | HTTP/private | Fail before runner |
| Daytona | Runner host `localhost` | Fail with reachability guidance |
| Claude | Existing Anthropic direct | Unchanged pass |
| Claude | Existing Anthropic gateway | Unchanged pass |

For successful Pi cases, verify the provider/model reported by Pi or the runner is the custom
connection provider ID and exact selected model. Do not accept only a plausible text response as
proof because the harness could have fallen back to another model.

