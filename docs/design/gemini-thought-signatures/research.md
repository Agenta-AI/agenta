# Research

Every reference is to `origin/release/v0.122.6` at `090e8bd81b` unless it names another
place. The local
GitButler workspace is older than that branch and has neither the skip value nor the runner
extension, so read the release branch, not the workspace.

## The gateway today

- `api/oss/src/core/gateways/llms/providers/passthrough/static_fields.py` holds every
  request rewrite. `apply_static_fields` sends chat completions on `VERTEX` to
  `_rewrite_vertex_chat` and on `DIRECT` with provider key `gemini` to
  `_rewrite_google_chat`. Both call `_fill_thought_signatures`, which writes
  `GEMINI_SKIP_THOUGHT_SIGNATURE` into every assistant tool call without a signature. The
  code landed in commit `3505c76a14` (2026-10-02).
- `adapter.py` relays the response. `_stream_body` yields each chunk after
  `CredentialEchoRelay.release`, and `_StreamUsageReader` reads a copy for usage. It already
  splits lines and JSON-parses every `data:` line. `_single_chunk_body` reads the whole body,
  scans it, yields it, then reads usage.
- `api/oss/src/apis/fastapi/gateways/utils.py` strips `content-length`,
  `content-encoding` and `transfer-encoding` from every relayed response, so a body that
  changes length is safe.
- `api/oss/tests/pytest/unit/gateways/test_gateways_llm_no_body_conversion.py` lists every
  file in the LLM plane allowed to call `json.loads`, with the reason. `adapter.py` is
  allowed because it reads the response for usage, "never reconstructed from this parse".
  That comment changes with this design.

## The runner already has a signature extension

`services/runner/src/extensions/gemini-thought-signatures.ts` (commit `3f559e3301`,
2026-10-06, first released in v0.122.5) keeps signatures on Pi's OpenAI path without
patching Pi:

1. A `provider_stream_event` handler reads signatures from the raw chunks, by stream index.
2. A `message_end` handler writes each one onto the finished tool call's `thoughtSignature`,
   which Pi persists.
3. A `context` handler indexes signed tool calls by id before each model call.
4. A `before_provider_request` handler puts `extra_content` back on each matching tool call,
   for the same model only.

It is registered in `services/runner/src/extensions/agenta.ts:515`. The hook it depends on,
`provider_stream_event`, exists in Pi 0.99.1. The extension is the only fix for a direct
custom OpenAI-compatible connection (credential mode `env`,
`services/runner/src/engines/sandbox_agent/pi-model-config.ts:376`), which reaches the
provider without the gateway.

Another agent verified on 2026-10-14 that the extension is live in production EU (image
`d6eb5047`, Pi 0.99.1, the hook runs before Pi parses the chunk), that it runs on the
in-process Pi custom-provider path, and that the gateway relays that stream unchanged. So
the skip value most likely lands only on unsigned parallel siblings.

## Which runner paths reach Gemini without the gateway

- `isPiModelConfigApplicable` (`services/runner/src/engines/sandbox_agent/pi-model-config.ts:301`)
  registers Pi's `openai-completions` custom provider only for provider `openai`, deployment
  `custom`, connection mode `agenta`.
- Commit `134b381ba3` makes `/gateways/llms/resolve` answer a Gemini key as `openai` +
  `custom`, so every agenta-mode Gemini run reaches Pi as an OpenAI-compatible custom
  provider pointed at the gateway.
- `sdks/python/agenta/sdk/agents/platform/connections.py:960`: "Live requests always supply
  both values. This direct path is only for offline and recorded-replay resolution." The
  direct path builds `credential_mode="env"`.
- `services/runner/src/engines/sandbox_agent/pi-assets.ts:499` maps the Agenta provider key
  `gemini` to Pi's built-in `google` provider, which speaks Google's native API. A
  self-managed run with a Gemini key takes this path, and Pi keeps signatures itself there.
- The extension filters on `api === "openai-completions"` and on `extra_content.google`, so
  it never acted on Pi's native Google client or on OpenRouter.

## LiteLLM's implementation

Read from LiteLLM 1.92.0 in another checkout, read only.

- `litellm_core_utils/prompt_templates/factory.py:65` defines
  `THOUGHT_SIGNATURE_SEPARATOR = "__thought__"`. `_encode_tool_call_id_with_signature`
  (line 1188) appends the signature. `_get_thought_signature_from_tool` (line 1207) prefers
  `provider_specific_fields`, then the id suffix, and falls back to a dummy signature for
  Gemini 3. We do not copy that fallback.
- `llms/vertex_ai/gemini/vertex_and_google_ai_studio_gemini.py:1593` to `1626` builds each
  streamed tool call chunk from one native `functionCall` part, which carries the
  `thoughtSignature`, and encodes the id in that same chunk.
- `factory.py:1182` and `1513` strip the suffix from the assistant id and from the tool
  result id before sending to Gemini.
- `utils.py:915` to `955` strips the suffix from every message when the target model is not
  Gemini. Agenta does not need this, because Pi normalizes ids on a model switch (below), and
  the gateway must not touch non-Gemini requests.

## How Pi treats tool call ids

From `@earendil-works/pi-ai` 0.99.1 (`dist/api/`):

- `transform-messages.js:68` to `113`: when the stored message's model differs from the
  target model, Pi drops `thoughtSignature` and calls the provider's `normalizeToolCallId`.
  For the same model, ids pass through unchanged.
- `anthropic-messages.js:933`: replace characters outside `[a-zA-Z0-9_-]` with `_` and cut to
  64 characters.
- `openai-completions.js:869` to `891`: ids with `|` are rebuilt to 40 characters; other ids
  are cut to 40 characters only when the provider is `openai`. The comment at line 870 notes
  that Responses ids "can be 400+ chars with special chars (+, /, =)".

## Where tool call ids go

Searched `services/runner/src`, `api/oss/src`, `api/ee/src`, `web/packages` and
`sdks/python/agenta`.

| Place | What happens to the id | Effect of a long id |
| --- | --- | --- |
| `api/oss/src/apis/fastapi/channels/models.py:188`, `ChannelMessageSendRequest.tool_call_id` | `max_length=200`; bound from `$ctx.tool.call_id` by the `send_channel_message` op (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:1796`) | HTTP 422. Must change. |
| `api/oss/src/core/channels/tools/service.py:438`, `459`, `966` | Hashed into the send key with `uuid5`, stored as `turn_id` in an unbounded `String` column (`dbs/postgres/channels/dbas.py:177`) | None |
| `services/runner/src/tools/relay-protocol.ts:47` | Sanitized, cut to 120 characters, used as a file name | None; the prefix stays unique |
| `services/runner/src/engines/inprocess/tools/bash-tool.ts:22` | Sanitized, cut to 64 characters, used in a file path | None |
| `services/runner/src/sessions/record-id.ts` | Hashed into a `uuid5` record id | None |
| Session records, interactions, approvals (`core/sessions/records/dtos.py:111`, `core/sessions/interactions/dtos.py:38`, `apis/fastapi/sessions/models.py:311`) | Unbounded `str`, compared for equality | None |
| `web/packages/agenta-chat` | Used as a key and compared for equality | None |
| OTLP (`apis/fastapi/otlp/extractors/adapters/logfire_adapter.py:175`) | Stored as `gen_ai.tool.call.id` | Larger spans only |

## Wire capture

`~/agenta-gemini-thought-signatures-evidence/capture.py` sends a two-city tool request (a
parallel step), sends the history back with the signatures as returned to get a sequential
second step, and then sends the step-two history with no signatures and with the signature
only in a `__thought__` id. The key and access token are never written.

- 2026-10-13 and 2026-10-14, direct endpoint: HTTP 400 "Please pass a valid API key" with the
  `GEMINI_API_KEY` from `hosting/docker-compose/ee/.env.ee.dev` and from the staging app env.
  `gcloud secrets versions access` needed an interactive reauth, so the staging env came from
  the copy another agent saved at `~/agenta-gemini-signature-test/.staging-app-env.json`.
- 2026-10-14, Vertex endpoint with `AGENTA_LLM_GATEWAY_VERTEX_SA_JSON_B64`, model
  `google/gemini-3.7-flash`, output in `vertex-gemini-3.7-flash/`:

| Request | Result |
| --- | --- |
| Step 1, stream | Two tool call frames. `index` 0, `call_656438`, signature of 508 characters. `index` 1, `call_656444`, no `extra_content`. Then a frame with `finish_reason` and `usage`. |
| Step 1, body | Same fields without `index`. First call signed (540 characters), sibling not. |
| Step 2, signed first call, unsigned sibling, stream | HTTP 200. One call, `index` 0, signature of 272 characters. |
| Step 2, no signatures | HTTP 400 "Function call is missing a thought_signature in functionCall parts". |
| Step 2, signature only in a `__thought__` id | HTTP 400, same message. |
| Step 3, all signatures as returned | HTTP 200, final answer. |
