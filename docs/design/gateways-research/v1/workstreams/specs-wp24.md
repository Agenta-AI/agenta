# WP24 — The relay-only south port

**Owns:** `core/gateways/llms/providers/`, `core/gateways/llms/registry.py`, and the
`provider_key` migration.
**Depends on:** WP23. **Blocks:** C2.

D34 forbids body conversion. This package enforces it, which means deleting the adapter that
does it and replacing the passthrough/translated split with one relay that can compose a URL
and apply an authentication scheme.

---

## First task: OD16's verification, before any code

For each of Azure, Bedrock, SageMaker and Vertex, and for each `direct` provider currently
routed to the translated adapter, answer three questions from the provider's own request
schema — not from what the current adapter does:

1. **Does it accept the bytes a front door relays?** With all three doors shipped (D38), the
   question is whether *some* door's body is what this upstream takes. Azure OpenAI takes the
   OpenAI body; a Bedrock Anthropic model takes the Anthropic Messages body.
2. **Can its URL be composed from route fields?** Azure needs base URL, deployment name and
   API version; Bedrock needs region and model id. If the model id must come out of the body
   and be removed from it, that provider fails question 1 rather than passing this one.
3. **Can its auth be applied without touching the body?** A header of any name is trivial. A
   signature is allowed and is real work; SigV4 signs the body it is given, which is
   compatible with relaying it.

**Record the answers in `open-designs.md` OD16 and close it.** A provider that fails becomes
unreachable and that is a stated outcome, not a gap — say so in the record rather than
keeping a converting path alive for it.

## The shape that replaces the split

One relay with two strategies per deployment:

- **Routing** — how to build the URL. Today's passthrough does `base_url + protocol path`;
  Azure and Bedrock add a composed path from route fields.
- **Authentication** — how to present the secret. A bearer header, a differently named
  header (`api-key`), a request signature, a minted token.

`select_upstream` stops choosing between two adapters and starts choosing a pair of
strategies. The mock stays a real adapter — it fabricates a response and is a test double,
not an upstream.

**`TranslatedLLMAdapter` is deleted, not deprecated.** A converting path that still exists is
a path something will use. litellm stays as a library for two jobs that are not conversion:
cost arithmetic (`cost_calculator.cost_per_token`, already used) and signing where the scheme
is a signature.

## The migration

`provider_key`'s `NOT NULL` loses its last justification here. `select_upstream`'s `direct`
branch is the only place a stored row's `provider_key` decides anything (entities.md §2.4);
with the split gone it decides nothing, and a `custom` row pointed at a self-hosted gateway
should not be made to name a provider that means nothing to it.

- Make it nullable. Keep the column: it is what `query_endpoints` filters on and what an
  upstream error names.
- The mock's selection moves off `provider_key == "mock"` onto something that is not a
  provider name — a deployment kind or the registry's own wiring. That short-circuit is a
  test-double artifact and should not be the reason a column is required.

## Contracts

- **No code path parses a request body except to read the policy fields.** This is the
  package's single assertion and it is checkable: the only `json.loads` of a request body in
  `core/gateways/llms/` is the policy parse.
- **Response bodies are never reconstructed.** Usage is read out; the bytes yielded are the
  bytes received.
- **Every provider OD16 clears is reachable through the door matching its shape**, and every
  provider it does not clear fails with a message naming the protocol it needs.
- **Streaming stays chunk-boundary faithful** — the existing passthrough discipline, now the
  only discipline.

## Tests

- Unit: routing strategy per deployment composes the expected URL from route fields.
- Unit: authentication strategy per deployment presents the secret the expected way, and a
  caller's own auth survives when no secret resolved (pass-through, OD15).
- Unit: byte-for-byte relay for every deployment that OD16 cleared, streamed and not.
- Unit: an unreachable provider raises, naming the protocol it would need.
- Unit: the repo contains no request-body `json.loads` outside the policy parse. A grep-style
  guard is legitimate here — this is the one invariant a future edit is most likely to break
  quietly.
- Migration: verified by hand against a real database (`api/AGENTS.md` — no migration tests
  in pytest).

## Out of scope

- The MCP plane, which has one protocol and never converted anything.
- Adding providers. This package moves existing ones and removes what cannot move.
