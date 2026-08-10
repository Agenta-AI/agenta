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

## Reading order

1. **`v1/brief.md`** — the question, the scope, and the inversion the gateways perform.
2. **`v1/early-findings.md`** — what is true in the tree today: the seams, what already
   exists, and what the gateway would replace. Everything else assumes this.
3. **`v1/decisions.md`** — the open decisions, each with what it hinges on and a leaning.

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
