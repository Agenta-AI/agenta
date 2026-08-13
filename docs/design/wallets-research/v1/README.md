# Wallets, v1

Everything gathered on credits, metering and billing, from four independent efforts that
never read each other. Nothing here has been implemented.

## Reading order

1. **[seams.md](seams.md)** — where the four efforts meet, what each already settled, and
   the questions that are nobody's yet. Read this first; it is the only document written
   for this branch and it says what the rest are for.
2. **[report.md](report.md)** — the decision document. One design, one plan, twelve
   decisions that are a product owner's rather than an engineer's. Sections 1 and 9 alone
   are ten minutes.
3. **[addendum-sandbox-metering.md](addendum-sandbox-metering.md)** — the same design
   compared, table by table, against the sandbox-metering track, with a recommendation for
   how the two fit.
4. **[proposal-a.md](proposal-a.md)** and **[proposal-b.md](proposal-b.md)** — the two
   complete designs the report compares. Written independently, then compared; their
   agreement is itself evidence, and `report.md` §6.1 lists where.
5. **[research/](research/)** — eight reports: the provider and caching, sixteen comparable
   credit products and what their users complain about, a ledger shortlist, four deep
   studies of individual projects, and gateway architecture.
6. **[prior-work/](prior-work/)** — the earlier efforts, verbatim.

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
