# Funded models

Status: implemented on `wallets/funded-models` (step 1.4 of the wallet release plan).

The LLM gateway's `builtin` namespace now serves real models from Agenta's own Google Cloud
Vertex AI account: Gemini 3.7 Flash and Gemini 3.8 Flash. A call to them is charged to the
organization's wallet at our rate card price. Before this step, `builtin` served only the mock
provider behind `AGENTA_GATEWAYS_MOCKS_ENABLED`.

## The endpoint

`builtin/agenta` (`api/oss/src/core/gateways/llms/catalog.py`):

- deployment kind `vertex_ai`, location `global` (fixed, because the rate card prices the
  global endpoint), project from `AGENTA_LLM_GATEWAY_VERTEX_PROJECT`;
- allowlist `google/gemini-3.7-flash` and `google/gemini-3.8-flash`, the names Vertex's
  OpenAI-compatible endpoint uses, so a request body relays to Vertex unchanged;
- served only when `AGENTA_LLM_GATEWAY_VERTEX_SA_JSON_B64` and
  `AGENTA_LLM_GATEWAY_VERTEX_PROJECT` are both set. It does not depend on the mock switch.

The gateway calls Vertex's OpenAI-compatible chat-completions endpoint
(`.../locations/global/endpoints/openapi/chat/completions`) with the existing passthrough
relay. The `global` location has no regional host, so the route uses
`aiplatform.googleapis.com` for it.

`builtin/agenta` is no longer a mock. The mock stays at `builtin/mock`, under the mock switch.

### Credential

The service-account key comes from configuration, never from a project's vault.
`builtin_llm_secret` builds it per call with no owner and origin `local` (platform money).
LiteLLM mints the access token. One minter is kept for the process, so its token cache is
used; before, a new minter per call minted a new token on every call. The API image had no
`google-auth`, so every Vertex route failed when it minted a token; the dependency is now in
`api/pyproject.toml`.

Decision: gateway-specific names (`AGENTA_LLM_GATEWAY_VERTEX_*`), not the starter-credits
proxy's `LITELLM_VERTEX_SA_JSON_B64`, `LITELLM_VERTEX_PROJECT`, `LITELLM_VERTEX_LOCATION`.
The API does not run LiteLLM's proxy, every API setting uses the `AGENTA_` prefix, and the
proxy goes away when the gateway replaces it. The cloud sets the new names from the same
secret value. The same service account works for both.

## How the harness reaches it

`POST /gateways/llms/resolve` answers a real `builtin` endpoint with provider `openai` and
deployment `custom`: the harness sees one OpenAI-compatible chat-completions surface,
whatever upstream answers it. The SDK needs no change. The runner registers the endpoint in
Pi's `models.json` as a custom provider named `agenta` with the `openai-completions`
dialect, the same path the starter-credits connection takes.

The agent picker (`web/packages/agenta-entities`) lists `builtin` endpoints from
`GET /gateways/llms/endpoints/`. A real one (any `deployment_kind` other than `mock`) is
offered only to `pi_core`, the harness that drives an OpenAI-compatible route with chat
completions. Codex drives such a route with the Responses API, which Vertex's endpoint does
not serve. The starter-credits connection pins the same harness for the same reason.

## Per-organization switches

The whole `/gateways/llms/*` surface, the listing included, is behind the
`llm-gateway-rollout` switch from step 1.1. An organization outside it gets
`llm_gateway_disabled` on the listing, so the picker offers no built-in row, and on
`/resolve` and the relay, so it cannot call the models either.

Changed from step 1.1: with the wallet on for the deployment, a `builtin` model call from an
organization whose `wallets-rollout` mode is `off` (absent from the payload, or a cold
lookup that timed out) is now refused (403 `builtin_models_not_enabled`, "Built-in models are
not enabled for this organization. Choose a model that uses your own provider key."), not
admitted. Until 2026-10-03 the refusal read `policy_denied`, "Entitlement wallet_balance
exceeded", which told the person they were out of credit.
`off` is not measured, so admitting it served the call free on our account. Sandbox and
managed-tool admission keep step 1.1's behaviour. The listing still shows the models to
such an organization (it does not read the wallet mode), so enroll an organization in both
flags together. A deployment with the wallet off for everyone (self-hosted, or EE with
`AGENTA_WALLETS_ENABLED=false`) admits every call: the operator pays its own Vertex account.
Do not configure the Vertex credential on a cloud deployment with the wallet off.

## Capabilities

A `builtin` call is charged from its tokens alone. The gateway refuses (400
`capability_not_allowed`) what the provider bills on top: `web_search_options` (Vertex maps
it to Google Search grounding), `extra_body` (Vertex's `google` extensions, cached content
and grounding among them), and any `tools` entry whose type is not `function`.

## Replacing the starter-credits connection

The starter-credits transfer job (`api/entrypoints/migrate_starter_credits_to_wallet.py`,
step 1.3) now deletes each organization's seeded "Agenta" vault connection in its `--apply`
stage, after the grant: the connection's proxy key is blocked by then. The built-in models
take its place in the picker. Chosen over keeping the row, and over archiving, which the
vault does not have. The vault gained `delete_managed_secret`, which deletes a managed row
only for the manager that owns it.

Saved agents are not rewritten. The gateway's resolve keeps them running with a narrow
alias (`RETIRED_STARTER_CREDITS_MODEL_ALIASES` in `core/gateways/llms/catalog.py`): when the
`starter-credits` custom endpoint is missing, the vault holds no connection under that slug,
and the saved model is
`Agenta/custom/vertex_ai/gemini-3.7-flash` (or its bare slug), it resolves to
`builtin/agenta` `google/gemini-3.7-flash`, where the wallet admits and charges the call.
Any other missing connection keeps its not-found error. The agent picker shows the
built-in row for such an agent. LLM-as-a-judge evaluators call the provider directly, not
through the gateway, so they get no alias; they fail with a message that says the
connection was retired. Details in
[credit-sources.md](credit-sources.md#starter-credits-transfer).

## Usage

Vertex reports usage in OpenAI's shape with two differences, both handled in
`providers/passthrough/adapter.py`:

- Cached input is inside `prompt_tokens` (`prompt_tokens_details.cached_tokens`), as with
  OpenAI. The gateway records fresh input and cache reads apart.
- Gemini's reasoning tokens are NOT in `completion_tokens`. They are only in
  `completion_tokens_details.reasoning_tokens` and in `total_tokens`. Reasoning is billed
  as output, so the gateway now measures output as `total_tokens - prompt_tokens` when that
  is larger than `completion_tokens`. For OpenAI the two are equal and nothing changes.
  Without this, a typical agent call would bill a fraction of its output.

Vertex's implicit cache has no per-token write charge and reports no cache writes. The rate
card prices a write as fresh input in case one is ever reported.

### Streams

For every streamed `builtin` chat completion, the gateway sets
`stream_options.include_usage` to true (a client's own other stream options are kept). Vertex
sends usage on the stream's last frame.

A caller that disconnects mid-stream used to leave no usage, so the call was free. The
gateway now keeps reading a `builtin` stream its caller left, for at most 120 seconds
(`STREAM_DRAIN_AFTER_DISCONNECT_SECONDS`), discards the bytes, and records the usage on the
last frame. A stream on the customer's own credential is closed at once, as before.

Remaining gap: a stream the upstream itself cuts off before its last frame, or one still
running after the 120 seconds, reports no usage. The gateway records the call with unknown
usage, not zero, and nothing is charged. Closing it needs an estimate from the bytes relayed.

## Tool calls and thought signatures

Gemini 3 returns a `thought_signature` with every tool call and refuses (HTTP 400) a later
request whose history holds that tool call without it. Pi's OpenAI client drops the
`extra_content` field that carries it, so an agent's second model call failed. For a Vertex
chat completion, the relay now fills the value Google documents for unsigned history
(`skip_thought_signature_validator`) into each assistant tool call that has none. A signature
the client kept is relayed as it came.

Cost: Google says a missing signature may reduce the model's reasoning quality across tool
calls. A follow-up can keep real signatures: Vertex sends a tool call and its signature in one
stream delta, so the gateway could carry the signature inside the tool-call id on the way out
and restore it on the way back, for any OpenAI client.

## Prices

`api/ee/src/core/measurements/rate_card.py`, CURRENT list price x 1.75. Source:
cloud.google.com/vertex-ai/generative-ai/pricing, read 2026-10-02, global endpoint, "through
December 31, 2026". Both models have the same price.

| Per million tokens | Vertex list | Ours (x 1.75) |
| --- | --- | --- |
| Input | $0.75 | $1.3125 |
| Cached input | $0.075 | $0.13125 |
| Cache write | none (implicit cache) | $1.3125 (priced as input) |
| Output (response and reasoning) | $3.75 | $6.5625 |

From January 1, 2027 Google lists both models at $1.50 / $0.15 / $7.50; the rows change
then. A non-global location lists 10% higher, so the location is fixed at `global` in code,
not configurable. The rate card version hash changed with these rows.

## Live check

On a local dev stack with a probe service account on Agenta's Google Cloud project, location
`global`. Both models were available.

- Listed org: the listing shows `builtin/agenta` with both models; relays return 200; each
  call left one measurement and one debit at the expected price, cache reads included
  (for example 2,457 fresh + 12,256 cached + 59 output = 5,221 micro-dollars).
- Unlisted org: 403 `llm_gateway_disabled` on the listing, `/resolve` and the relay; no
  measurement, no debit.
- UI: the picker shows "Built-in: agenta" with Google: Gemini 3.7 Flash and 3.8 Flash under
  Pi. A Pi agent turn on Gemini 3.8 Flash ran a shell command and answered; three model
  calls were charged.

Known display gap: Pi prices a custom provider's model at $0, so the turn footer in the chat
shows `$0.00`. The wallet charge is correct; the footer is Pi's own estimate.
