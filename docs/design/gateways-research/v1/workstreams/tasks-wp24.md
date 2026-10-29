# WP24 — tasks

Read [`specs-wp24.md`](specs-wp24.md) first. Branch from WP23.

## Phase 0 — verification, before any code

- [ ] For each of Azure, Bedrock, SageMaker, Vertex, and each `direct` provider currently in
      `_DIRECT_TRANSLATED_PROVIDERS`, answer OD16's three questions from the provider's own
      request schema. Not from what the current adapter does.
- [ ] Write the answers into `open-designs.md` OD16 and close it. A provider that fails is
      recorded as unreachable, with the protocol it would need.
- [ ] Commit: "gateways(docs): close OD16 with the per-provider answers".

**If this phase says most providers fail, stop and report.** The package's shape assumes
most pass; if they do not, the honest outcome is a smaller reachable set, and that is a
scope conversation rather than something to code around.

## Phase 1 — strategies

- [ ] Split what the adapters do into a routing strategy (build the URL from route fields)
      and an authentication strategy (present the secret). One pair per deployment kind.
- [ ] Move Azure onto routing (base URL + deployment + api-version) and header auth
      (`api-key`), with no body parse.
- [ ] Move the cloud resellers OD16 cleared onto routing plus their signing strategy.
- [ ] `select_upstream` chooses a strategy pair, not an adapter. Keep it pure — no I/O — so
      the table stays reviewable on its own, as it is today.
- [ ] Unit: URL composition per deployment; auth presentation per deployment; a caller's own
      auth survives when no secret resolved.

## Phase 2 — deletion

- [ ] Delete `core/gateways/llms/providers/translated/`. Not deprecated, not left unwired —
      a converting path that still exists is a path something will use.
- [ ] Keep litellm for cost arithmetic and for signing. Remove every other use.
- [ ] Unit: the only request-body `json.loads` in `core/gateways/llms/` is the policy parse.
      A guard test, deliberately — this is the invariant a future edit breaks most quietly.
- [ ] Unit: byte-for-byte relay per cleared deployment, streamed and not.
- [ ] Unit: an unreachable provider raises, naming the protocol it needs.

## Phase 3 — the column

- [ ] Move the mock's selection off `provider_key == "mock"` onto the registry's wiring or a
      deployment kind. A test double must not be why a column is required.
- [ ] Migration: `llms_endpoints.provider_key` becomes nullable. Keep the column and its
      index — `query_endpoints` filters on it.
- [ ] Update the DTOs, mappings and the endpoint document in `entities.md` §2.4.
- [ ] Verify the migration by hand against a real database, upgrade and downgrade
      (`api/AGENTS.md` — no migration tests in pytest).
- [ ] `ruff format` && `ruff check --fix`; run the API unit tests.
- [ ] Commit: "gateways(llm): one relay, no conversion".

## Definition of done

- `TranslatedLLMAdapter` does not exist.
- No request body is parsed except for the policy fields, enforced by a test.
- OD16 is closed with per-provider answers, including the failures.
