# WP23 — tasks

Read [`specs-wp23.md`](specs-wp23.md) first. Branch from C1.

## utils.py — one parser per protocol

- [ ] Read `parse_llm_call_context` (`apis/fastapi/gateways/llms/utils.py:13`) first. It is
      the pattern: a minimal parse for two fields, tolerant of a body it cannot read.
- [ ] Add `parse_responses_call_context` and `parse_messages_call_context` beside it. Each
      reads its own protocol's model and stream fields and returns the same
      `LLMCallContext`. Three small functions, not one clever one.
- [ ] Add the per-protocol ceiling field names: Chat Completions `max_tokens` /
      `max_completion_tokens`, Responses `max_output_tokens`, Messages `max_tokens`. The
      endpoint's config key stays `settings.max_output_tokens`.
- [ ] Unit: each parser reads its protocol's fields; each returns a usable context from a
      body it cannot parse rather than raising into the relay.

## proxy.py — the routes

- [ ] Register `/{namespace}/{name}/v1/responses` and `/{namespace}/{name}/v1/messages` for
      both `standard` and `custom`, POST only, with explicit `operation_id`s following the
      existing naming (`llm_gateway_<door>_<namespace>`).
- [ ] Handlers stay thin: read the body, parse the context with that door's parser, delegate
      to the service. No branching on protocol below the handler.
- [ ] `/v1/models` is untouched.
- [ ] A door addressed on an endpoint whose upstream does not speak it returns 404 naming
      both, using the frozen exceptions table — no new error codes.

## service.py — the ceiling, and nothing else

- [ ] `_check_ceilings` learns which request field to read from the context's protocol
      rather than trying all three names. This is the one service change; if a second is
      needed, report it before making it.
- [ ] Unit: the ceiling binds per protocol, rejects above and passes at or below (D25).

## Tests

- [ ] Unit per door: route reaches handler, context is right, body passes through untouched.
- [ ] Unit per door: usage extracted from that protocol's response and its final streaming
      frame.
- [ ] Unit: allowlist refusal happens on every door before any secret is touched.
- [ ] Unit: the full route table matches the design exactly, the way the wave-1 router tests
      do — a door added without a test is a door nobody knows about.
- [ ] Acceptance: a request in each protocol relays byte for byte against a mock speaking it;
      compare bytes.
- [ ] `ruff format` && `ruff check --fix` in `api/`; run the API unit tests.
- [ ] Commit: "gateways(llm): responses and messages front doors".

## Definition of done

- Three doors, each byte-for-byte in both directions.
- Nothing below the handler knows which protocol it is serving.
- WP24 can scope OD16 against the full door set.
