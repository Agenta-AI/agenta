# Cheaper platform tools in the playground build kit

Status: PLANNING — design workspace only, no implementation.
Date: 2026-07-20 · **Revised 2026-07-26** after a re-baseline and a code-grounded security review.

The playground advertises 13 platform-op schemas to the model on every turn — **18,353 tokens**
measured — before the model has done anything. Every always-on tool is also a "wander target" that
derails runs.

**What the re-baseline changed.** Three ops are 88% of that bill, and a *single* schema object
(`_build_agent_template_delta_schema`, 6,441 tokens, embedded in **two** ops) is 70% of it. The
long tail of ten ops is 2,120 tokens combined. So the win is not spread across the catalog — it is
concentrated in one duplicated object. See [baseline.md](baseline.md).

That reordered this project. The **schema diet** — originally a side-slice — is now the headline:
~84% of the win, no runner change, no wire change, no permission change. The **discovery
meta-toolset** — originally the headline — is a follow-up worth ~14% more, and it carries by far
the highest risk in the project ([security.md](security.md)).

## Decisions (locked)

- **Schema diet ships first, alone, and is independently valuable.** It is the bulk of the win at
  near-zero risk. The replacement guidance (`references/config-schema.md`) already ships with the
  skill and the skill already mandates reading it before `commit_revision`.
- **The meta-toolset is deferred behind evidence**, not cancelled. Gate it on: a measured
  post-diet baseline, an answer on prompt caching, and a demonstrated reliability problem that
  fewer visible tools actually fixes.
- **Seam for the meta-toolset = runner advertisement layer.** `advertisedToolSpecs` in
  `services/runner/src/tools/public-spec.ts:57`, consumed at exactly two sites
  (`pi-assets.ts:353`, `environment.ts:721`). Verified 2026-07-26.
- **Permission fidelity is a four-site problem, not a one-line one.** See
  [security.md](security.md). This is the project's dominant risk.
- **Op-set curation is dropped, not deferred.** Hiding the 5-op event pack saves ~1,052 tokens
  (~5%) and risks the agent being unable to schedule when a user pivots mid-conversation. Not
  worth a capability regression. Revisit only with hard wander data.
- **Skills are out of scope.** Already progressive (64-token announcement).
- **Playground overlay only.** No change to any saved/committed agent.
- **No commits during planning.** Implementation happens later on its own branch.

## Deliverables

- [baseline.md](baseline.md) — **measured** per-op cost, the concentration finding, the caching gap.
- [security.md](security.md) — what collapsing 13 ops behind one name breaks; the four gate sites.
- [context.md](context.md) — problem, scope, non-goals, product language, success criteria.
- [research.md](research.md) — the current advertise/execute path with `file:line`, and the seams.
- [design.md](design.md) — the diet, then the meta-toolset; execution + permission path.
- [plan.md](plan.md) — the sliced implementation plan, each slice with an exit check.
- [status.md](status.md) — living source of truth: locked decisions, open questions, next action.

## Intended outcome

**After the diet (Slices 1–2):** a playground turn carries ~2,970 tokens of platform-op schema
instead of 18,353, with every tool still visible, every schema still authoritative enough to call
against, and not one line of permission code touched.

**If the meta-toolset later clears its evidence bar (Slice 3):** the model sees two small platform
tools instead of thirteen, a turn costs a low-hundreds constant that stays flat as the catalog
grows, and every op still runs with its exact self-targeting binding and approval gate — with the
four-site permission work done properly and tested per mutating op.
