# Context

## Problem

Open a playground agent that shows "Tools: None" and type "hi". The turn costs ~15K prompt
tokens. Nothing the author did explains it: the cost is the playground **build kit**, which
injects ~13 platform-op tool schemas into the agent template and advertises every one of them to
the model on every turn.

Two costs, not one:

- **Tokens.** Measured (tiktoken `o200k_base`, 2026-07-17): the ops dominate. `test_run` (~6.5K)
  and `commit_revision` (~5.8K) each embed the full ~5.5K-token agent-template delta schema;
  `query_spans` ~1.3K; all ops together ~15.4K. Skills are NOT the cost (a ~68-token
  announcement only). This is a ~5x tax on every turn, paid before the model is useful.
- **Reliability.** The internal-tools review
  (`../builder-agent-reliability/tools-review/part-2-internal-tools.md`) found the same tools are
  a *double* cost: "each unused tool is context cost plus a wander target (the capstone showed
  extra visible tools derail runs)." Fewer advertised tools is a correctness win, not just a bill.

It scales the wrong way: adding a catalog op is a one-line data change that ships to every
playground agent unconditionally, so every op we add makes every turn heavier.

Skills already solved this exact shape — on disk, only name+description in the prompt, body
loaded on demand. The platform ops never got the same treatment.

## Scope (this delivery)

- The **runner advertisement layer** for playground platform ops: `advertisedToolSpecs()` in
  `services/runner/src/tools/public-spec.ts`, consumed by the Pi and Claude delivery paths.
- A **discovery meta-toolset** (`agenta_ops` + `agenta_op`) that replaces the always-advertised
  op schemas: list ops cheaply, fetch one schema on demand, execute against the private spec.
- A **schema diet** for the two heaviest op schemas (`commit_revision`, `test_run`) —
  independently valuable, folded in as its own slice.
- A **token + reliability baseline** so before/after is measured, not asserted.
- A **one-line nudge** in the always-loaded `build-an-agent` skill so the model uses the
  meta-toolset.

## Out of scope for the first delivery

- **Skills.** Already progressive; untouched.
- **Which ops belong in the overlay** (the build-kit-tools-cleanup debate). Orthogonal — this
  work makes any op set cheap, which lowers the pressure to prune.
- **External tool discovery (`discover_tools`).** That discovers *Composio* tools to wire into an
  agent; it stays as-is and is itself one of the ops we disclose.
- **User / gateway / code / client tools.** The POC targets platform ops (the measured cost). The
  mechanism can generalize later.
- **Committed non-playground agents.** They advertise only what their author declared; no problem
  today.
- **Dynamic real-name re-advertisement (M2).** Advertising a loaded op under its real name with a
  schema-validated signature is a productionization option, evaluated after the POC — not built
  here.

## Product language

- **Platform op** — an existing Agenta endpoint exposed to the agent as a tool, defined in the
  code catalog `op_catalog.py` (e.g. `commit_revision`, `query_spans`).
- **Advertised spec** — the `{name, description, inputSchema, …}` projection the model sees;
  distinct from the **private resolved spec** the runner executes from.
- **Discovery meta-toolset** — the small fixed set (`agenta_ops`, `agenta_op`) that stands in for
  the op schemas: list, describe-on-demand, invoke.
- **Disclosure** — moving an op's full schema out of the prompt (paid every turn) into a tool
  result (paid once, only when fetched).

## Success criteria

1. A no-op turn's platform-op prompt cost drops from ~15K to a low-hundreds constant, and stays
   flat as ops are added to the catalog.
2. Capability parity: the build-an-agent lab loop (discover → wire → commit → test → schedule)
   passes with the disclosed toolset.
3. No safety regression: self-targeting `$ctx` bindings and per-op approval/permission behave
   exactly as today, verified per mutating op.
4. Reliability does not regress (target: fewer "wander" failures) on the lab matrix.
5. Cost of laziness is bounded: ≤1 extra round-trip per distinct op used; a schema fetched at
   most once per op per conversation.
