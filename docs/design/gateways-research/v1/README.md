# Gateways

Design for an LLM gateway and an MCP gateway, built as one policy core with two protocol
surfaces.

**Status: skeleton.** `raw/` holds the source research behind these positions. Documents here
are structured but not complete — each states what it must establish and what is missing.

## Posture

Six claims anchor the design and constrain everything downstream:

1. **Everything transits a gateway.** No bypass, no exceptions, custom providers included —
   what is custom lives *behind* the gateway, never beside it. A governance boundary with an
   exception is not a boundary.
2. **Identity is not a new problem.** Every authenticated call already resolves an
   organization, workspace, project and user, and is rejected if any is missing. Both
   gateways inherit that principal rather than inventing one.
3. **The gateways hold no secret material.** A domain row carries a secret id; the secrets
   service holds the value; the consumer resolves it at use time. This is the pattern
   webhook subscriptions and SSO providers already use.
4. **Most of the secret model is already built.** The auth-scheme axis, the
   ready/needs-auth/needs-input state machine, the one hosted-redirect flow serving both
   schemes, and the refresh and revoke ports all exist. The gateways **copy those shapes into
   their own domain** rather than joining the one that has them — an integrations domain and a
   traffic boundary share a word, not a concern.
5. **Transparent on the data path, never on the consent path.** The gateway absorbs
   selection, injection, refresh, retry and audit. It cannot absorb consent, which needs a
   human at first use and again on a step-up scope challenge.
6. **The gateway owns all six concerns, and this design owns the gateway.** Identity and
   permissions, governance, secrets, and metering and billing. Three other efforts specify a
   LLM gateway; they are callers of this one, not parallel designs (D11, D12).

## Reading order

1. **`decisions.md`** — what is settled, and the rationale load-bearing enough to constrain
   future work. Everything else assumes these.
2. **`architecture.md`** — the shape: the two planes, where boundaries land relative to the
   existing layering, and the path a call takes in each direction.
3. **`entities.md`** — the data model and its full stack, layer by layer, following the
   repo's standard domain structure.
4. **`secrets.md`** — the vocabulary, secret kinds, ownership, and how user-level and
   project-level secrets resolve against each other.
5. **`policy.md`** — the shared plane both gateways evaluate against: identity,
   authorization, governance, audit, metering, routing.
6. **`contract.md`** — the ports. What callers speak to the gateway, and what the gateway
   speaks to adapters.
7. **`mcp.md`** — everything MCP-specific.
8. **`models.md`** — everything model-provider-specific.
9. **`plan.md`** — the work packages and what depends on what. No sizing, no schedule.
10. **`notes.md`** — replaced designs and open observations.
11. **`workstreams/`** — one spec and one task list per package, plus the file-ownership
    table and the parallel-work rules.

Alongside the design, not part of its argument:

- **`libraries.md`** — what to reuse rather than build, and what was rejected. Read before
  implementing anything that looks like an OAuth client or a secret store.
- **`open-designs.md`** — design questions still open, ordered by what depends on them.
- **`open-reviews.md`** — what to verify against the code when the ports are implemented.
- **`raw/`** — the research this design grew out of: the codebase surveys, the protocol
  findings, and the original framing. Read when you want to know why a document says what it
  says.

**Every document except `decisions.md` and `notes.md` states only what is.** A shape that was
proposed and replaced lives in `notes.md`; rationale that constrains future work lives in
`decisions.md`.

## Why `mcp.md` and `models.md` exist

They are quarantine. Protocol facts and provider facts change on someone else's schedule,
and letting them leak into `architecture.md` or `entities.md` makes those documents rot with
every upstream revision. The other documents stay protocol-neutral by pushing their
protocol-specific facts into these two.

This is the same reason the channels design keeps one platform document: the neutral
documents are the ones that have to survive.

## Scope

In: the outbound plane for every caller — model calls and tool/MCP calls — and everything the
gateway owns for both: identity and permissions, governance, secrets, and metering and billing
(D12). The secret model, including user-level secrets designed but not scheduled. The
self-hosted posture, since it is the reason this work exists rather than adopting a hosted
provider.

**Owned is not the same as scheduled.** A concern may arrive later; none is designed out. The
test for each increment is whether it forecloses a later one.

Out: the tool **catalog** question, settled in the prior research as "do not become a catalog
vendor." Trigger delivery, which is a separate subsystem for structural reasons — the
protocol is request/response and carries no inbound events. Prompt and response
transformation. The internal first-party tool-delivery channel, which is a different concern
and is deliberately not modelled here.
