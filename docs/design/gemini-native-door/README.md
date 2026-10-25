# Built-in Gemini over Google's native protocol

Status: approved by Mahmoud on 25 October 2026 (no feature flag; the gateway translator is
dropped). Implementation follows the workflow in "Workflow" below.

## Why

Pi drives the built-in Gemini models (`builtin/agenta`: `google/gemini-3.8-flash`,
`google/gemini-3.7-flash`, `google/gemini-4-argon`) with its `openai-completions` client. The
gateway relays those calls to Vertex's OpenAI-compatible endpoint
(`.../endpoints/openapi/chat/completions`).

That endpoint stalls. On staging (25 October 2026), 120 follow-up calls carrying two tool calls
with thought signatures and their results stalled 56 times on the OpenAI-compatible stream. The
same conversations stalled 0 times in 120 on Vertex's native `streamGenerateContent`, and 0
times without streaming. Some requests stayed stuck for minutes. v0.124.2 (PR #7795) limits the
damage: a 90 s first-byte cut, two retries, a changed retry body. It does not remove the cause.

The OpenAI client also loses data Gemini needs. It drops the `extra_content` that carries
thought signatures, so the gateway hides them in tool call ids (`__thought__`). It drops the
signatures on text parts entirely, which Pi's own code says makes Gemini "intermittently end
mid-task". And because the built-in model is registered in Pi with only an `id`, Pi never sends
a thinking level at all.

Pi already ships a native Gemini client, `google-generative-ai` (built on `@google/genai`). It
accepts a custom base URL and custom headers, stores thought signatures natively in its session
records, and sends thinking levels. So the fix is to let Pi speak native Gemini to the gateway,
and let the gateway relay native bytes to Vertex.

Rejected: translating OpenAI chat completions to native Gemini inside the gateway. Only Pi uses
the built-in models (`BUILTIN_CHAT_COMPLETIONS_HARNESSES = {pi_core}` in
`web/packages/agenta-entities/src/secret/core/agentModelCandidates.ts`), so a translator would
add a permanent body-conversion layer (an exception to D34) for no caller that needs it. The
draft and its comparison with LiteLLM, the Vercel AI SDK and Portkey are kept outside the repo
as reference.

## The call after the change

```
Pi google-generative-ai
  POST {gw}/gateways/llms/builtin/agenta/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse
  X-AG-Credentials: Secret ...        (from models.json headers, as today)
  x-goog-api-key: agenta-gateway      (Pi requires a key; a placeholder, never forwarded)
  body: native GenerateContentRequest (contents, systemInstruction, tools, generationConfig)
        |
gateway (new native door, protocol GEMINI)
  auth, built-in guard, allowlist (google/<model>), capability guard, wallet admission,
  default thinking level, stall rules, relay
        |
Vertex  POST https://aiplatform.googleapis.com/v1/projects/{p}/locations/global/
             publishers/google/models/gemini-3.8-flash:streamGenerateContent?alt=sse
        |
answer relayed as received; usage read from usageMetadata; errors rebuilt in Google's shape
```

## Components

### 1. API: the native door

- `LLMProtocol` gains `GEMINI = "gemini"` (`api/oss/src/core/gateways/llms/dtos.py`).
- One route in `api/oss/src/apis/fastapi/gateways/llms/proxy.py`, built-in only:
  `POST /builtin/{provider}/v1beta/models/{model}:streamGenerateContent`. Pi's Google client
  calls only `generateContentStream` (no `countTokens`, no `generateContent`, no file upload),
  so no other native operation is served. The model comes from the path and must be a bare
  Gemini id (no slash); the door names it `google/<model>` so the existing allowlist and rate
  card apply unchanged. Caller query parameters (`key`, `alt`) are never forwarded; the
  upstream URL sets `alt=sse` itself.
- The door builds the `LLMCallContext` itself and passes it to the service; the service skips
  `_parse_call_context` for `GEMINI`. Everything else in `relay_chat_completion` runs as today:
  policy, wallet admission, platform secret, retries, drain and record.
- Capability guard for `GEMINI` (`_check_builtin_capabilities`) is an allowlist, not a
  denylist, because the native request has many fields that select another model or a priced
  feature (`generationConfig.routingConfig`, `modelConfig`, `responseModalities`,
  `speechConfig`, `imageConfig`, `modelArmorConfig`, hosted tools, `cachedContent`). Top level:
  `contents`, `systemInstruction`, `tools`, `toolConfig`, `generationConfig`, `safetySettings`.
  Each tool object holds only `functionDeclarations`. `generationConfig`: `temperature`,
  `topP`, `topK`, `maxOutputTokens`, `stopSequences`, `seed`, `presencePenalty`,
  `frequencyPenalty`, `responseMimeType`, `responseSchema`, `responseJsonSchema`,
  `thinkingConfig`, and `candidateCount` only when 1. Parts in `contents` and
  `systemInstruction` may carry `text`, `inlineData`, `functionCall`, `functionResponse`,
  `thought`, `thoughtSignature`; `fileData` is refused (Vertex would fetch a URL on the
  platform's account). Exact camelCase keys, so snake_case aliases are refused too.
- Ceilings: `_CEILING_FIELDS[GEMINI]` reads `generationConfig.maxOutputTokens` (nested; the
  ceiling helper gains a path).
- Thinking: the door normalizes `generationConfig.thinkingConfig` for the built-in models,
  so every request carries a level these models accept. No thinking setting at all,
  `thinkingBudget: 0`, or `thinkingLevel: MINIMAL` become `thinkingLevel: LOW` (thinking off).
  Any other `thinkingBudget` is dropped, so Vertex uses its default level (MEDIUM). `LOW`,
  `MEDIUM`, `HIGH` and `includeThoughts` pass unchanged. Reason (Pi 0.99.1,
  `google-shared.js`): Pi's Google client sends `thinkingBudget: 0` for thinking "off", and a
  budget of `-1` for any level on `gemini-4-argon` (its level-model check is a regex on
  `gemini-3`); Gemini 4 refuses `thinkingBudget` (400), and 3.7, 3.8 and 4 refuse `MINIMAL`.
  Same "off means LOW" rule as v0.124.2 on the OpenAI door.
- Old sessions: no gateway rewrite. Pi treats the old OpenAI-route messages as another model's
  (different model id and API), drops their signatures and normalizes their tool call ids
  before they reach the gateway (`transform-messages.js`), so a gateway split would see
  truncated ids. Gemini validates signatures only on the current turn, so an old session works
  from its next turn; only a turn in flight during the switch can fail once. Checked in the
  end-to-end step.
- Stall rules stay: `response_headers_timeout_seconds` (90 s) and two retries; a stalled retry
  appends one newline per stall to the last text part of `systemInstruction`.
- Routing: `routing.vertex_gemini_native_url(route, stream)` builds the publisher URL.
- Usage: `_usage_from_payload` gains a `GEMINI` branch over `usageMetadata`, explicit
  counters only: `input = max(promptTokenCount + toolUsePromptTokenCount -
  cachedContentTokenCount, 0)`, `cache_read = cachedContentTokenCount`,
  `output = candidatesTokenCount + thoughtsTokenCount`. No `totalTokenCount` fallback (it
  would count tool-use input as output). Usage arrives on the last event; a stream cut before
  it records no usage, as on the OpenAI door today.
- Errors: an error answered before the stream starts (status body, domain refusal) uses
  Google's shape, `{"error": {"code": <http status>, "message": <marked sentence>, "status":
  <canonical status>}}`. `@google/genai` raises that, and the runner still finds the
  `⟦agenta_code:…⟧` marker. Built-in errors stay unquoted (Vertex names the project). An error
  after the stream started cannot reach Pi as a marked error: `@google/genai` 2.21.0 does not
  raise `data: {"error": ...}` events and Pi reports "Google stream ended without a finish
  reason" (Codex, mocked fetch). The runner classifies that sentence as a lost connection.
- Terminal detection: a native stream has no `[DONE]`. The relay treats a stream as finished
  when an event's `candidates[0].finishReason` is set (parsed per event, `GEMINI` only), so a
  clean end is not reported as a lost connection.
- Caller headers: the door must not forward `x-goog-api-key` or `?key=`. The egress boundary
  admits only allowlisted caller headers; a unit test pins that the placeholder never reaches
  Vertex.

### 2. API: the resolve hint

`LLMGatewayConnectionResolution` gains `protocol: Optional[LLMProtocol]`. For a `builtin`
Vertex endpoint it is `GEMINI`; for everything else it is absent. `provider_key` and
`deployment_kind` stay `openai` / `custom`, so an older SDK or runner that ignores the field
keeps today's OpenAI route.

### 3. SDK (agent service)

- `platform/connections.py` reads `protocol` from the resolution.
- `ResolvedConnection` gains `protocol: Optional[str]`.
- `endpoint.base_url` stays the `/v1` route, as today (see "Version skew").
- The run request to the runner carries the hint as `modelConnection.protocol`.

### 4. Runner

- `pi-model-config.ts`: `PiProviderApi` widens to include `"google-generative-ai"`. When
  `modelConnection.protocol === "gemini"`, the plan uses that API, the connection's base URL
  with its trailing `/v1` replaced by `/v1beta` (`@google/genai` appends
  `/models/{model}:...` and is told the base already carries the version), the same
  placeholder key and the same `X-AG-Credentials` header. The model id is
  the bare Gemini id (`gemini-3.8-flash`); Pi's catalog id stays `<slug>/<id>`.
- The model entry declares `reasoning: true`, so the person's thinking setting reaches Gemini
  (today Pi never sends one for the built-in models). The gateway makes the levels safe (see
  "Thinking" above), so the runner needs no `thinkingLevelMap`.
- The runtime identity (`session-identity.ts`, `lifecycle/desired-state.ts`) includes the
  protocol, so a warm runtime is rebuilt when a connection switches between the two routes.
- Error classifier (`errors.ts`, `gateway-error.ts`): map the strings Pi's Google client
  produces: our marked error from a status body, "Google stream ended without a finish reason"
  (lost connection), "Provider stopped with: MALFORMED_FUNCTION_CALL" (today's regex expects
  `finish_reason: malformed_function_call`), and the client's timeout and 429 wording.

## Version skew

API, agent service (SDK) and runner deploy apart. Each new field is optional and ignored by
older readers, so every order is safe:

| API | SDK | Runner | Result |
|---|---|---|---|
| old | any | any | no `protocol`; OpenAI route |
| new | old | any | SDK drops `protocol`; OpenAI route |
| new | new | old | runner ignores `protocol` and uses the unchanged `/v1` base; OpenAI route |
| new | new | new | native route |

The SDK never changes the base URL; only the runner that understands `protocol` derives the
native base from it. That is what keeps the third row safe. The OpenAI door for `builtin`
stays, for every row but the last.

Accepted window (Mahmoud's "fewest rollout steps" rule): during a rolling API deploy a new
replica can advertise `protocol` while the run's next call lands on an old replica, which
answers 404 for the native route. That lasts as long as the rollout (minutes) and fails at
most the affected turns once. The alternative, shipping the route one release before the
advertisement, doubles the rollout. Rollback is safe: an old API stops advertising, and a warm
runtime is rebuilt because the protocol is part of its identity.

## Thinking, by model

Pi 0.99.1 sends, with `reasoning: true` on the model entry:

| Person's setting | gemini-3.7 / 3.8-flash | gemini-4-argon | After the gateway |
|---|---|---|---|
| off | `thinkingBudget: 0` | `thinkingBudget: 0` | LOW |
| minimal | `MINIMAL` | `thinkingBudget: -1` | LOW / Vertex default (MEDIUM) |
| low, medium, high | the level | `thinkingBudget: -1` | the level / Vertex default (MEDIUM) |

Argon's level is lost because Pi's level-model check is a regex on `gemini-3`. Honoring it would
need a patch to Pi; not worth it now. Retries: Pi retries the initial request once
(`GATEWAY_PI_RETRY`) and the gateway twice, so a call can reach Vertex up to six times.

## Security

- The platform's Vertex credential stays in the API, as today.
- The placeholder `x-goog-api-key` is dropped at the door and never forwarded.
- The built-in guard (`_refuse_builtin_outside_agent_run`) applies to the new routes.
- The capability guard refuses everything the rate card does not price.

## Tests

- API unit: door routing and context from the path; allowlist with the `google/` prefix;
  capability refusals; ceiling on `maxOutputTokens`; default LOW written only when absent;
  `__thought__` split; nudge on stall retries; usage from `usageMetadata` (stream and whole);
  error shapes (status body, stream break, domain errors) with the marker; terminal marker; the
  placeholder key never reaches Vertex; wallet admitted once and charged once across retries.
- SDK unit: resolution with and without `protocol`; base URLs.
- Runner unit: models.json for `protocol: "gemini"` (API, base, headers, thinking map) and
  without it (unchanged); classifier strings.
- End to end (local stack, staging Vertex): tools, parallel tools, MCP schemas, image and PDF,
  stop, park and resume, a session started on the OpenAI route, model switches, thinking off
  and high, wallet charge equals Vertex usage, forced 400, 429, wallet refusal, forced stall.
- Stall A/B: 120 follow-ups through the OpenAI door and 120 through the native door.
- Release gate: a new built-in Gemini cell.

## Workflow

1. This design, reviewed by Codex (gpt-6-astra, medium).
2. API slice, unit tests, Codex review.
3. SDK and runner slice, unit tests, Codex review.
4. Local end to end on a worktree stack with staging's Vertex account.
5. Stall A/B on staging's Vertex account.
6. Live QA as a real user, recordings in the PR comment.
7. Staging deploy, release gate with the new cell.
8. Stacked PRs (API, then SDK and runner) into the next release branch.

## Design review (Codex, gpt-6-astra medium, 25 October 2026)

Applied: streamed errors are classified in the runner instead of relying on a marked SSE event;
the gateway signature split was dropped (ineffective after Pi's id normalization); the
capability guard became an allowlist; thinking is normalized for what Pi actually sends,
including Argon; the protocol joins the runtime identity; usage uses explicit counters with
tool-use input as input; terminal detection parses events; only `streamGenerateContent` is
served. Accepted with reason: the rolling-deploy window (see "Version skew").
