# Gateways research

Design for two gateways — an **LLM gateway** and an **MCP gateway** — treated as one problem
with two protocol surfaces.

**Status: v1, in progress.** [`v1/`](v1/) is the design; its `README.md` carries the posture,
the reading order, and the scope. Documents there are structured but not complete — each
states what it must establish and what is still missing.

There is no v2 and there should not be one until v1 is superseded rather than merely extended.

## Why the two are one design

They are the same shape. A run has exactly two kinds of outbound dependency needing a
credential we hold: the **model** it calls, and the **tools** it calls. Today both are
resolved and shipped outward as secrets. The runner wire already models them as two consumers
of one pattern — a route, a credential, a policy — and describes a gateway MCP server as "an
HTTP MCP server whose URL happens to be ours."

Governance, identity, authorization, compliance, metering and routing are **the same six
concerns over different nouns**. Designing the two gateways separately means building that
plane twice and having it disagree with itself. That is the failure mode this research exists
to avoid.

## Layout

- **[`v1/`](v1/)** — the design. Start at its `README.md`.
- **[`v1/raw/`](v1/raw/)** — the research behind it: the codebase surveys, the protocol
  findings, and the framing documents the design grew out of. Read these when you want to know
  *why* a document says what it says.
- **`v1/notes.md`** — positions that were taken and reversed, with the reasoning. Read it when
  a shape in the design looks wrong and you want to know whether it was already tried.
- **`v1/open-designs.md`** and **`v1/open-reviews.md`** — working documents: what is still
  undecided, and what to verify against the code when the ports are implemented.

## Relationship to the earlier tool-gateway research

A prior docs-only effort covered the **tool/MCP** half: the provider landscape, why no
open-source equivalent of the incumbent catalog exists, the two auth layers, and a recommended
direction of "be an MCP client/gateway rather than clone a catalog vendor."

That work is input, not a duplicate. This design keeps its conclusions on the tool side and
asks the question it did not: what happens when the model plane gets the same treatment, and
what do the two share. It also postdates that research on one material point — the protocol
revision it assumed has since been replaced, and `v1/mcp.md` covers what changed.

## Scope

In: the outbound plane for every caller — model calls and tool/MCP calls — and the identity,
policy, audit and metering both need. The credential model, including user-level credentials
designed but not scheduled. The self-hosted posture, since it is the reason this work exists
rather than adopting a hosted provider.

Out: the tool **catalog** question, settled earlier as "do not become a catalog vendor."
Trigger delivery, a separate subsystem for structural reasons — the protocol is
request/response and carries no inbound events. Prompt and response transformation. The
internal first-party tool-delivery channel, which is a different concern and deliberately not
modelled here.
