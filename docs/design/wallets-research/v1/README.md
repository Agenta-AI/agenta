# Wallets, v1

Everything gathered on credits, metering and billing, from four independent efforts that
never read each other. Nothing here has been implemented.

## Reading order

**Canonical for schema and names: [entities.md](entities.md).** Where any other document
disagrees with it about a table, a column, or a name, it wins.

### Planning the current wave

1. **[waves.md](waves.md)** — the checkpoint-and-wave delivery model, and the node types.
2. **[wave-1.md](wave-1.md)** — the checkpoint boundary, fixed inputs, the replay invariant,
   and the completion evidence. Its graph is in [wps-1.md](wps-1.md), [ims-1.md](ims-1.md)
   and [cus-1.md](cus-1.md), with per-node specifications under [nodes/](nodes/).
3. **[preflight.md](preflight.md)** — the graph and specification review `waves.md` requires
   before any node work starts. Read it before forking a worktree.
4. **[entities.md](entities.md)** — the data model: what each entity is and is not, an example
   row for each, the stream contracts, and the column rule.
5. **[open-designs.md](open-designs.md)** — the register of what is still open, one item at a
   time, each self-contained.
6. **[out-of-scope.md](out-of-scope.md)** — deferrals, each with the condition that reopens it.

### The reasoning underneath

7. **[seams.md](seams.md)** — where the four efforts meet and what each already settled.
8. **[mechanics.md](mechanics.md)** — the three classes of resource, every kind of value in
   and out, the two money conversions, and what a subscription does to a wallet. **Its §3
   naming table and its schema shapes are superseded by `entities.md`**; its class model,
   enumerations and conversions are current.
9. **[report.md](report.md)** — the decision document. Sections 1 and 9 are ten minutes. Its
   `credit_*` schema is superseded; `entities.md` §1 maps it responsibility by responsibility.
10. **[addendum-sandbox-metering.md](addendum-sandbox-metering.md)** — compared table by table
    against the sandbox-metering track.
11. **[proposal-a.md](proposal-a.md)** and **[proposal-b.md](proposal-b.md)** — the two designs
    the report compares, written independently.
12. **[research/](research/)** — eight reports behind all of it.
13. **[prior-work/](prior-work/)** — the earlier efforts, verbatim.

## Where each document came from

| Path | Origin |
| --- | --- |
| `report.md`, `addendum-sandbox-metering.md`, `proposal-a.md`, `proposal-b.md`, `research/` | credits repo, `design/credits-and-gateway` |
| `prior-work/activation-credits/` | `docs/activation-credits-proposal`, PR 5463 (closed) |
| `prior-work/gateway-spike/` | the same branch's OpenRouter-era gateway spike |
| `prior-work/sandbox-metering/` | `feat/metering-track-c` (specs, tasks, naming, two findings files) |
| `prior-work/track-b-metering/` | `feat/metering-track-b`, PR 5039 (open draft) |
| `prior-work/track-c-billing/` | `feat/metering-track-c`, PR 5040 (open draft) |
| `prior-work/track-d-byos/` | `feat/metering-track-d` (no PR) |
| `prior-work/extend-meters/`, `prior-work/dynamic-access-and-billing/` | `main` — the meter and plan-catalog work already shipped |
| `prior-work/billing-phantom-usage/` | `docs/billing-phantom-usage-investigation` |
| `prior-work/sandbox-metering-PR-BODIES.md` | PR bodies for 5037, 5039, 5040 |

Documents under `prior-work/` are verbatim archives and keep whatever names and framing
they were written with. Documents written for this branch do not.

**No schedules.** Duration estimates have been removed from every document above
`prior-work/`. Phases and their ordering stand, because the dependencies are real and
`report.md` §7.5 turns on what cannot be retrofitted later; the calendar attached to them
was invention. Anything that survives in an archived document is not part of the design.

## Not here, deliberately

**The gateway design.** [docs/design/gateways-research/](../gateways-research/) owns it,
including the model plane, the run token, and the north-port shape it adopted from
`report.md`. `research/04-gateway-architecture.md` stays because it is the survey the
report's §5.4 rests on, not because it is a competing design.

**The plan catalog and the Stripe subscription surface.** Already shipped; see
`prior-work/dynamic-access-and-billing/` and `prior-work/extend-meters/` for what exists.
