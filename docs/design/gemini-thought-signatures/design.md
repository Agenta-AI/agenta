# Design: the gateway carries Gemini thought signatures in the tool call id

Baseline `090e8bd81b` (`origin/release/v0.122.6`). Bare file names are in
`api/oss/src/core/gateways/llms/providers/passthrough/`.

## Summary

The gateway appends each Gemini thought signature to its tool call id in the response, and
splits it back out on the next request. The gateway's skip value goes away, and so does the
runner's Pi extension that does the same job today. One layer owns signatures, and the PR
removes about 396 more lines than it adds.

## Google's wire shape, as captured

Captured on 2026-10-14 from Vertex's OpenAI-compatible endpoint (`google/gemini-3.7-flash`,
the gateway's own service account) with a parallel step followed by a sequential step. The
raw frames are in `~/agenta-gemini-thought-signatures-evidence/vertex-gemini-3.7-flash/`.

- **Stream.** Each tool call arrives whole in its own `data:` frame: one delta with
  `index`, `id`, `type`, `function` (name and full arguments) and, when signed,
  `extra_content.google.thought_signature`. The id and the signature are always in the same
  delta. A last frame carries `finish_reason: "tool_calls"` and `usage`. Lines end in `\n`.
- **Parallel step.** Only the first call is signed (`index` 0). The sibling (`index` 1) has
  no `extra_content`.
- **Body.** `choices[0].message.tool_calls[j]` has the same fields without `index`.
- **Sizes.** Ids look like `call_656438`. Signatures were 272 to 540 base64 characters, so a
  signed id is about 300 to 560 characters.
- **Round trip.** History with the real signature on the first call and none on the sibling:
  HTTP 200, and the third step also succeeds. The same history with no signatures: HTTP 400
  "Function call is missing a thought_signature". The same history with the signature only
  in a `__thought__` id: HTTP 400, so Google does not read the id and the gateway must
  restore `extra_content`.

The sibling result also shows that the skip value is not needed for unsigned siblings, which
is where it lands today.

## Wire shape we emit

```text
<id Google gave>__thought__<signature>
```

`__thought__` is LiteLLM's separator. Only `id` changes, and `extra_content` stays in the
response as Google sent it. The signature is protocol context for the next call to the same
model, so it belongs in `extra_content`. We copy it into the id because the id is the one
field every client sends back, and the gateway owns the encoding at both ends.

## Response path

`static_fields.py` gains `encode_thought_signatures`, which edits a parsed chunk or body in place:

```python
def encode_thought_signatures(payload: Any) -> bool:
    """Append each Gemini thought signature to its tool call id, so a client that keeps
    only the id sends the signature back."""
    signed = False
    choices = payload.get("choices") if isinstance(payload, dict) else None
    for choice in choices if isinstance(choices, list) else []:
        part = (choice.get("delta") or choice.get("message")) if isinstance(choice, dict) else None
        for call in (part.get("tool_calls") if isinstance(part, dict) else None) or []:
            extra = call.get("extra_content") if isinstance(call, dict) else None
            google = extra.get("google") if isinstance(extra, dict) else None
            signature = google.get("thought_signature") if isinstance(google, dict) else None
            if signature and call.get("id"):
                call["id"] = f"{call['id']}{THOUGHT_SIGNATURE_SEPARATOR}{signature}"
                signed = True
    return signed
```

and `is_gemini_chat(deployment_kind, protocol, provider_key)`, true for chat completions on
`VERTEX` and on `DIRECT` with provider key `gemini`. `relay_chat_completion` computes it once
and passes `sign` to both body builders.

**Streams.** `_StreamUsageReader`, renamed `_StreamReader`, already splits lines and parses
every `data:` line. With
`sign`, `feed` returns the complete lines it finished instead of the chunk it was given,
`flush` returns the tail, and `_read` returns either the line or, when
`encode_thought_signatures` changed it, `b"data: " + json.dumps(payload).encode() + b"\n"`. The reader
handles every complete line in a chunk before it checks the 1 MiB frame limit, so a large
chunk of whole lines is never dropped. On a Gemini route a single line over the limit fails
the stream with the gateway's upstream error, because relaying it unread could lose a
signature. Without `sign`, `feed`
returns its input, so other routes relay the upstream bytes unchanged. `_stream_body` yields
what `feed` and `flush` return. Editing only the frame that carries the id is enough,
because the capture shows the id and the signature in the same delta. The edit runs after
`CredentialEchoRelay.release`, so the copied bytes were already checked for an echo.

**Bodies.** `_single_chunk_body` yields the re-serialized body when `sign` is set and
`encode_thought_signatures` changed it. The usage read and the echo scan stay on Google's bytes.
`apis/fastapi/gateways/utils.py` already strips `content-length` from relayed responses.

**What this costs the "relay bytes unchanged" rule.** Decision D34 (checked by
`test_gateways_llm_no_body_conversion.py`) says the gateway relays response bytes as
received. On Gemini routes, frames that carry a signed call are re-serialized, and frames
are held until their newline, so chunk boundaries become line boundaries. Google ends every
frame with a newline, so the delay is small. Other routes keep the rule in full. The request
path already rewrites Gemini bodies, so this extends an existing Gemini exception to the
response. The docstrings and the D34 test comment change to say so.

## Request path

`_split_thought_signatures(messages, restore=True)` replaces `_fill_thought_signatures` in
`_rewrite_vertex_chat` and `_rewrite_google_chat`:

```python
def _split_thought_signatures(messages: List[Any], *, restore: bool) -> bool:
    # Cuts the `__thought__` suffix off every assistant `tool_calls[].id` and every tool
    # message's `tool_call_id`. With `restore`, writes the suffix back to the call as
    # `extra_content.google.thought_signature`.
```

Google sees its own id on both the call and the tool result. `GEMINI_SKIP_THOUGHT_SIGNATURE`,
its comment block and `_fill_thought_signatures` are deleted, so an unsigned call goes to
Google as sent. Google checks signatures only in the current turn, so:

- Unsigned siblings in a parallel step: accepted (captured above).
- Unsigned calls in earlier turns, from an old session or another model: accepted.
- A turn in progress while the change deploys: its earlier calls have plain ids, so its next
  step gets HTTP 400. The user's next message starts a new turn, which works.
- A model switch inside one turn, or a caller that invents tool calls in the current turn:
  HTTP 400.

We accept the last two. They are loud and end with the turn, and the rule is no
compatibility path.

**Other chat routes.** A session that moves from Gemini to another model sends the signed
ids of its history to that model. Pi cuts ids only when its provider is `openai`, and the
runner names a custom connection by its slug, so an OpenAI or Azure endpoint behind a custom
connection would get ids of 300 to 560 characters, which those endpoints refuse. So every
chat completion on a route that is not Gemini goes through the same helper with
`restore=False`, which drops the suffix. A byte check comes first: a body that does not
contain `__thought__` is relayed untouched, without a parse.

## Runner: delete the extension

`services/runner/src/extensions/gemini-thought-signatures.ts` and its registration in
`extensions/agenta.ts` are deleted, with `tests/unit/gemini-thought-signatures.test.ts`, the
"a Gemini tool call on an OpenAI-compatible endpoint" block in
`tests/integration/inprocess/pi-loop.test.ts`, the `signature` step option in
`tests/utils/scripted-model.ts`, the `extensionEnv` fixture option in
`tests/utils/inprocess-host.ts` (only that block uses it), and the four hook names in
`tests/unit/extension-tools.test.ts`, which goes back to `assert.deepEqual(pi.handlers, {})`.

The API and the runner deploy separately, and every order works. A new gateway with an old
runner runs both mechanisms, which agree, because the restored signature and the extension's
`extra_content` come from the same response. An old gateway with a new runner falls back to
today's skip value, with no 400.

## Runner paths that bypass the gateway

The extension acts only on Pi messages whose API is `openai-completions` and whose stream
carries `extra_content.google`. These are the runner's Gemini paths:

| Path | Through the gateway? | After the extension is gone |
| --- | --- | --- |
| Agenta mode, live (`connection.mode` `agenta`), built-in or own Gemini key, Vertex, Agenta-funded credit | Yes. `/gateways/llms/resolve` answers Gemini as `openai` + `custom`, and the SDK always builds a gateway connection when it has a gateway URL and credential (`sdks/python/agenta/sdk/agents/platform/connections.py:960`) | Covered by the gateway |
| Self-managed mode with a Gemini key | No | Pi uses its built-in `google` provider, which speaks Google's native API and keeps signatures itself. The extension never ran here. No change |
| OpenRouter `google/*` models | No | OpenRouter returns reasoning in its own fields, not `extra_content`. The extension never ran here. No change |
| Self-managed, or offline and recorded-replay resolution, with an OpenAI-compatible connection whose base URL is Google's OpenAI endpoint | No | HTTP 400 on the second tool step of every turn |
| A `CUSTOM` gateway connection whose base URL is Google's OpenAI endpoint | Yes, but registered as `openai` + `CUSTOM`, so `is_gemini_chat` is false | Not supported. HTTP 400 on the second tool step. Use the `gemini` or `vertex` connection instead |

Only the last two rows lose anything. The `CUSTOM` row needs no code: detecting Google by
URL would be a new subsystem, and the standard connections already work. For the
bypass row, two answers are possible: Two answers are possible:

- **Route every runner model call through the gateway.** Self-managed mode exists so a user
  can run the runner with their own keys and no Agenta API, so this would remove that mode
  or require a gateway in it. It is a change to the SDK resolver and the runner's model
  plans, in the hundreds of lines, and it changes what self-managed means.
- **Do not support Gemini through Google's OpenAI-compatible endpoint outside the gateway.**
  Cost: zero lines. A self-managed user with a Gemini key already gets Pi's native Google
  client, which works.

Recommendation: the second. The lost path is a self-managed user who configures Google's
OpenAI endpoint by hand as a generic OpenAI connection, and the native `gemini` provider
serves that user better.

## Where tool call ids are stored

A signed id is about 300 to 560 characters. The full search is in
[research.md](research.md#where-tool-call-ids-go). One place breaks:
`ChannelMessageSendRequest.tool_call_id` (`api/oss/src/apis/fastapi/channels/models.py:188`)
has `max_length=200`, and the `send_channel_message` tool binds `$ctx.tool.call_id` into it,
so a signed channel post would get HTTP 422. The change removes that `max_length`. The value
lands in an unbounded `String` column and in a `uuid5` key. Everywhere else the id is
sanitized and cut before it names a file, kept in an unbounded field, hashed, or compared for
equality. On a model switch, Pi cuts old ids to 64 characters for Anthropic and to 40 for
a provider named `openai`, which keeps the unique `call_` prefix. Other chat routes lose the
suffix in the gateway (see "Other chat routes").

## Tests

- `api/oss/tests/pytest/unit/gateways/test_gateways_llm_static_fields.py`: the two
  skip-value tests become one restore test, parametrized over both Gemini routes, that checks
  the clean id and `extra_content` on the call, the clean `tool_call_id` on the result, and
  an unsigned sibling sent as it came. One test checks that a non-Gemini route drops the
  suffix. One parametrized test covers `encode_thought_signatures` on a delta and on a body.
- `test_gateways_llm_relay_adapter.py`, with the real captured Vertex frames (signatures
  shortened): one test, parametrized over stream and body, splits the signed call across two
  upstream chunks on a Gemini route and checks the encoded id, the unsigned sibling and the
  usage. One test relays the same frames on a non-Gemini route and checks the chunks byte
  for byte. One test feeds a chunk of more than 1 MiB of whole lines and checks that the
  signed id and the usage survive, and one checks that a single line over the limit fails.
- `test_gateways_llm_no_body_conversion.py`: the `adapter.py` comment changes.
- Runner tests: deleted as listed above.

## Cost per change

As implemented (the estimate before Codex's review was about 164 added and 560 removed).

| File | Added | Removed |
| --- | --- | --- |
| `static_fields.py` | 83 | 32 |
| `adapter.py` | 96 | 63 |
| `apis/fastapi/channels/models.py` | 1 | 1 |
| `test_gateways_llm_static_fields.py` | 43 | 30 |
| `test_gateways_llm_relay_adapter.py` | 122 | 0 |
| `test_gateways_llm_no_body_conversion.py` | 2 | 2 |
| `test_gateways_builtin_agenta.py`, `test_measurements_integration.py` (rename) | 4 | 4 |
| `services/runner/src/extensions/gemini-thought-signatures.ts` | 0 | 184 |
| `services/runner/src/extensions/agenta.ts` | 0 | 3 |
| `services/runner/tests/unit/gemini-thought-signatures.test.ts` | 0 | 227 |
| `services/runner/tests/integration/inprocess/pi-loop.test.ts` | 0 | 50 |
| `services/runner/tests/utils/scripted-model.ts` | 2 | 14 |
| `services/runner/tests/utils/inprocess-host.ts` | 1 | 3 |
| `services/runner/tests/unit/extension-tools.test.ts` | 1 | 7 |
| Total | 355 | 620 |

Net: 265 lines removed. Production code alone: 180 added and 283 removed. The response
path grew past the estimate with the oversize failure, the non-Gemini suffix strip, and the
tests Codex asked for.

## Alternatives considered

- **Keep the runner extension and drop only the skip value.** Smallest diff, but signatures
  stay a Pi concern and every other client of the gateway stays unsigned.
- **Keep `extra_content` in Pi's OpenAI client.** A Pi patch to port on every Pi bump.
- **Store signatures in the gateway by tool call id** (Redis). State in a stateless relay.
- **Call Google's native API from the gateway.** Format conversion, which D34 forbids.

## Open questions

1. **Drop Gemini through Google's OpenAI endpoint outside the gateway?** Recommended answer:
   yes, as argued in "Runner paths that bypass the gateway".
2. **Remove the cap on `tool_call_id`, or raise it?** Recommended answer: remove it. The id
   is the harness's opaque value and the column is unbounded.
