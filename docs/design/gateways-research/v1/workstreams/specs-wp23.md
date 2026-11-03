# WP23 — Protocol front doors

**Owns:** `apis/fastapi/gateways/llms/proxy.py`, `apis/fastapi/gateways/llms/utils.py`.
**Depends on:** C1. **Blocks:** WP24.

Three front doors instead of one (D33, D38). This is what makes D34 survivable: a gateway
that may not convert a body reaches an upstream only through a door that speaks its protocol.

---

## The route table

Today `LLMGatewayProxy` registers four routes — chat completions and models, per namespace
(`proxy.py:150`). After this package, per namespace:

```text
POST  /{namespace}/{name}/v1/chat/completions    (exists)
POST  /{namespace}/{name}/v1/responses           (new)
POST  /{namespace}/{name}/v1/messages            (new)
GET   /{namespace}/{name}/v1/models              (exists, unchanged)
```

`/v1/models` is **not** a front door. It answers from the endpoint's allowlist (R3) and has
no upstream protocol behind it.

`{namespace}` is `builtin`, `standard`, or `custom`. WP28 adds the development builtin
providers; future Agenta-supplied providers use the same door. Adding a door means adding it
for every namespace the plane serves, which is the reason the handlers are thin and the parsing
is not.

## What each door owns, and what it does not

Everything behind the door is protocol-blind — resolution, filters, ceilings, secrets,
adapter selection and audit are all unchanged and must not learn a protocol. Each door owns
exactly three things:

1. **The policy-field parse.** `LLMCallContext` needs the model id and the stream flag, and
   nothing else. `parse_llm_call_context` (`llms/utils.py:13`) is the Chat Completions
   version; each door gets its own, reading its own protocol's field names.
2. **The ceiling binding.** Chat Completions names it `max_tokens` or
   `max_completion_tokens`; Responses names it `max_output_tokens`; Messages names it
   `max_tokens`. The *config* key stays `settings.max_output_tokens` on the endpoint — what
   varies is which request field it is compared against (D25: rejected, never clamped).
3. **Usage extraction.** Each protocol reports usage in its own shape and in its own final
   streaming frame. The adapter reads it out of the response without reconstructing the
   response, exactly as the Chat Completions path already does.

**The body is never parsed beyond those fields, and never re-serialized.** That is D34, and
it is the property this package exists to preserve rather than erode. The minimal parse is
already the pattern — WP6 wrote it that way — and three doors is three copies of a small
function, not one clever one.

## Contracts

- **Byte-for-byte, per door.** A request relays to the upstream unchanged, and the response
  relays back unchanged, streamed or not. Asserted as bytes, not as re-decoded equivalence.
- **The service is not touched.** `LLMGatewayService.relay_chat_completion` takes a body, a
  context and headers; a second door supplies a different context from a different parse and
  calls the same method. If a door cannot be added without changing the service, say so
  before changing it.
- **A door with no upstream is a 404, not a 500.** Addressing `/v1/messages` on an endpoint
  whose provider does not speak it fails cleanly and names both.
- **The exceptions table is frozen** (`apis/fastapi/gateways/exceptions.py`, the seed). New
  doors reuse it; they do not add codes.

## Tests

- **Unit, per door.** TestClient plus a mock service: the route reaches the handler, the
  context carries the right model and stream flag, and the body is passed through untouched.
- **Unit, per door.** The ceiling binds to that protocol's field name; a request above it is
  refused with `CeilingExceededError`, and one at or below it is not.
- **Unit, per door.** Usage is extracted from that protocol's response and its final
  streaming frame.
- **Unit.** A model outside the endpoint's allowlist is refused on every door, before any
  secret is touched.
- **Acceptance.** A request in each protocol relays byte for byte against a mock that speaks
  it; the comparison is on bytes.

## Out of scope

- Removing `TranslatedLLMAdapter` (WP24). Until then a door may reach a converting adapter,
  which is temporary and is why WP24 follows immediately.
- Which upstreams each door can actually reach — that is OD16, verified in WP24.
- The MCP plane, which has one protocol and no door problem.
