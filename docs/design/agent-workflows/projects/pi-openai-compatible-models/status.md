# Status

Last updated: 2026-07-15

## State

**Implemented, end-to-end verified, and committed on two lanes. PRs against `main` pending.**

Everything in this plan is built and passes its unit suites and a live end-to-end matrix on the
EE dev stack (2026-07-14 and 2026-07-15). The design held: no vault schema change and no `/run`
schema change. The service formalizes the existing `custom` kind as an OpenAI-compatible Chat
Completions endpoint, the runner writes Pi's `models.json`, and the UI relabels the kind. Two
lanes carry the change: `feat/pi-openai-compatible-models` (the SDK and runner backend) and
`feat/pi-openai-compatible-ui` (the frontend). Both PRs target `main`; the frontend PR merges
after or with the backend one, because the custom entries stay hidden until the backend
capability ships. See the PR bodies in the session scratchpad.

## What shipped, by area

### Service and SDK (`sdks/python/agenta/sdk/agents/`)

- A provider-less named connection with `kind=custom` resolves to provider `openai`, deployment
  `custom`, and its key in `OPENAI_API_KEY`. An explicit provider family is preserved, so existing
  Anthropic gateway connections are unchanged.
- `harness_allows_pair` implements the resolved-pair table. Pi plus `openai` plus `custom` is newly
  allowed. Arbitrary provider plus `custom` on Pi is still rejected.
- Named Agenta connections defer provider acceptance until after the vault record resolves. The
  pre-resolve check validates only the connection mode.
- `pi_core` and `pi_agenta` publish deployments `["direct", "custom"]`.
- An unusable base URL raises `EndpointResolutionError`, a new subclass that returns HTTP 422. The
  connection never resolves with `endpoint=None`, so the harness cannot fall back to a default
  endpoint.
- The connection `{mode, slug}` rides the `/run` wire through `model_ref` threading in
  `adapters/harnesses.py`, for the Pi and Agenta harnesses. The slug no longer leaks in as a
  provider family; it stays connection identity.

### Runner (`services/runner/src/engines/sandbox_agent/`)

- A new `pi-model-config.ts` holds a pure builder that returns a `PiModelConfigPlan`. It applies
  only for Pi plus provider `openai` plus deployment `custom` plus connection mode `agenta`. An
  incomplete applicable request returns a typed error, not a silent no-op.
- The runner writes `models.json` in the shape
  `{"providers": {"<slug>": {baseUrl, api: "openai-completions", apiKey: "$OPENAI_API_KEY",
  models: [{id}]}}}`. Locally it writes the file `0600` and atomically into the isolated per-run Pi
  directory. A plan run never seeds the operator's `auth.json`. On Daytona it uploads the file to
  `DAYTONA_PI_DIR` before session creation. A no-plan run removes any stale file best-effort.
- Builder, write, and upload failures are terminal. The run never falls through to a default
  provider.
- When a plan exists, the runner requests the fully qualified model id `<slug>/<model>`. This fixes
  a suffix collision that could silently route a request to `api.openai.com`.

### UI (`web/`)

- The `custom` provider-kind label reads "OpenAI-compatible endpoint". The stored value is
  unchanged.
- Selecting a custom connection defaults the provider family to `openai` and preserves the
  connection slug.
- Custom vault models appear only where the harness reaches them (`openai`, `custom`).
- The Playwright `model-hub.ts` strings are updated. They still need a live Playwright run (see
  the open-issues log).

## Deviations from the plan

These are the places where the built code differs from the plan text, with the reason for each.

- **`model_ref` threading in `adapters/harnesses.py`.** The plan assumed the connection `{mode,
  slug}` already reached the wire. It did not for a named custom connection. Live end-to-end
  testing surfaced the gap, and the fix threads the structured `model_ref` for Pi and Agenta.
  Claude is left unchanged on purpose.
- **`EndpointResolutionError` and the 422 status.** Review added a dedicated typed error for an
  unusable base URL, and set `EndpointResolutionError`, `UnsupportedProviderError`, and
  `UnsupportedDeploymentError` to return HTTP 422. Without the explicit `status_code` these fell
  through to 500 in the invoke remap.
- **The fully qualified `<slug>/<model>` request.** Review found that the bare model id could
  suffix-match the wrong provider and route to `api.openai.com`. The runner now requests the
  qualified id whenever a plan exists.
- **Fail-loud endpoint applies to all custom deployments.** The endpoint resolution guard is not
  Pi-only. Any `custom` deployment with an unusable base URL fails loudly, including a Claude
  Anthropic gateway.

## Test evidence

- SDK agents suite: 669 passed.
- Runner suite: 1190 passed, plus the wire golden fixtures.
- Frontend entity-ui suite: 208 passed.
- Live end-to-end (EE dev stack, 2026-07-14 and 2026-07-15): the happy path passes local and on
  Daytona, with the custom endpoint reply proven, the `models.json` contents verified, and
  `auth.json` isolation verified. The 422 fail-loud paths pass. Standard Pi and Claude regression
  runs pass. The UI click-through passes.

## Deferred follow-ups

Tracked with full context in [open-issues.md](open-issues.md). In brief: harden the Daytona stale
`models.json` cleanup, require `apiBaseUrl` at save time for `kind=custom`, add an engine-level
test for an incomplete applicable request, run the updated Playwright suite live, thread
`model_ref` for the Claude template if its named-connection wire identity is wanted, and add the
Anthropic Messages dialect.
