# Gateways research

Design for two gateways — an **LLM gateway** and an **MCP gateway** — treated as one
problem with two protocol surfaces.

**Status: exploration.** Nothing here is settled. `v1/decisions.md` lists what has to be
decided and what the decision hinges on; it is the document to argue with.

## Why the two are one design

They are the same shape. A run has exactly two kinds of outbound dependency that need a
credential we hold: the **model** it calls, and the **tools** it calls. Today both are
resolved from the vault and both are shipped into the sandbox as secrets. The wire already
models them as two consumers of one pattern — a route, a credential, a policy — and the
runner protocol says so explicitly, describing a gateway MCP server as "an HTTP MCP server
whose URL happens to be ours."

Governance, identity, authorization, compliance, metering, and routing are **the same six
concerns over different nouns**. Designing the two gateways separately means building that
plane twice and having it disagree with itself. That is the failure mode this research
exists to avoid.

## Where to start

**Building it? Read [`v2/`](v2/).** That is the design, and `v2/README.md` carries its own
reading order. It is a skeleton — each document states what it must establish and what is
still missing.

**Want to know why it looks like that? Read `v1/` below.** That is the research phase: the
codebase survey, the protocol findings, and the positions that were reversed along the way.

## v1 reading order

1. **`v1/brief.md`** — the question, the scope, and the inversion the gateways perform.
2. **`v1/decisions.md`** — what is settled and why. Everything else assumes these.
3. **`v1/early-findings.md`** — what is true in the tree today: the seams, what already
   exists, and what the gateway would replace.
4. **`v1/existing-gateway-model.md`** — the connections/catalog/tools/triggers model that is
   already built, and the one piece that is missing from it.
5. **`v1/credential-model.md`** — what the gateway hides from callers, and the consent it
   cannot hide.
6. **`v1/secrets-scoping.md`** — user-level credentials and how they resolve against
   project-level ones. Designed, not scheduled.
7. **`v1/libraries.md`** — what to reuse rather than build, and what was rejected.
8. **`v1/raw/`** — source research. `mcp-2026-07-28.md` covers the current protocol
   revision, which postdates the earlier tool-gateway research.

Working documents, not part of the argument:

- **`v1/open-designs.md`** — design questions still open, ordered by what depends on them.
- **`v1/open-reviews.md`** — what to verify in the code when the ports are implemented.
- **`v1/notes.md`** — replaced positions and observations. Read it when a shape here looks
  wrong and you want to know whether it was already tried.

**Every document except `notes.md` and the two open-* files states only what is.** Rationale
that constrains future work lives in `decisions.md`; history lives in `notes.md`.

## Relationship to the MCP gateway provider research

A prior docs-only research effort covered the **tool/MCP** half: the provider landscape,
why no open-source equivalent of the incumbent catalog exists, the two auth layers, and a
recommended direction of "be an MCP client/gateway rather than clone a catalog vendor."
That work is input, not a duplicate — this research keeps its conclusions on the tool side
and asks the question it did not: what happens when the model plane gets the same
treatment, and what do the two share.

## Scope

In: the outbound plane for agent runs — model calls and tool/MCP calls — and the
identity, policy, audit, and metering that both need. The self-hosted story, since it is
the reason the tool-side research exists at all.

Out: the tool **catalog** question (settled direction: do not become a catalog vendor),
trigger delivery (a separate subsystem by design, request/response protocols have no
inbound events), and prompt/response transformation.
