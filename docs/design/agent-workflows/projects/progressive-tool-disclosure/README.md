# Progressive tool disclosure (playground build kit)

Status: PLANNING — design workspace only, no implementation.
Date: 2026-07-20

The playground advertises ~13 platform-op tool schemas to the model on every turn, before the
model has done anything — ~15K prompt tokens on a bare "hi", plus every extra always-on tool is
a "wander target" that derails runs. Skills already avoid this (on disk, only name+description
in the prompt, body loaded on demand). This project applies the same idea to the platform ops:
advertise a small **discovery meta-toolset** and load a full op schema only when the model asks.
The lazy layer lives at the runner's `advertisedToolSpecs()` seam, so it is harness-agnostic
(Pi + Claude) and touches no committed agent config.

## Decisions (locked)

- **Seam = runner advertisement layer.** Intercept the advertised projection at
  `services/runner/src/tools/public-spec.ts` (`advertisedToolSpecs`), consumed at exactly two
  sites (`pi-assets.ts`, `environment.ts`). Execution + permission stay below it, unchanged.
- **Skills are out of scope.** Already progressive.
- **Op-catalog contents / overlay-cleanup is out of scope.** This work makes *any* op set cheap
  to carry; it does not decide which ops belong.
- **Playground overlay only.** No change to any saved/committed agent.
- **Schema diet is complementary, not exclusive.** Shrinking the embedded agent-template schema
  is worth doing regardless and lands as its own slice.
- **No commits during planning.** Implementation happens later on its own branch.

## Deliverables

- [context.md](context.md) — problem, scope, non-goals, product language, success criteria.
- [research.md](research.md) — how the current advertise/execute path works, with `file:line`,
  and the numbered seams the plan pins.
- [design.md](design.md) — the meta-toolset, the execution + permission path, alternatives.
- [plan.md](plan.md) — the sliced implementation plan, each slice with an exit check.
- [status.md](status.md) — living source of truth: locked decisions, open questions, next action.

## Intended outcome

A playground author opens an agent and types a message. The model sees two small platform tools
(`agenta_ops` to list what it can do, `agenta_op` to fetch a schema and act) instead of a wall
of op schemas. A no-op turn costs a low-hundreds token constant instead of ~15K, and stays flat
as the catalog grows. Every op still runs with its exact self-targeting binding and approval
gate. Builds are cheaper and, per the internal-tools review, more reliable.
