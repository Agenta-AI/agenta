# Context

## Problem

Open a playground agent that shows "Tools: None" and type "hi". The turn carries **18,353 prompt
tokens** of platform-op schema (measured 2026-07-26, tiktoken `o200k_base` —
[baseline.md](baseline.md)). Nothing the author did explains it: the cost is the playground
**build kit**, which injects 13 platform ops into the agent template and advertises every one of
them to the model on every turn.

Two costs, not one:

- **Tokens.** And they are *concentrated*, not spread. `test_run` (7,777) + `commit_revision`
  (6,878) + `query_spans` (1,578) are **88%** of the bill; the other ten ops are 2,120 tokens
  combined. One schema object — `_build_agent_template_delta_schema()`, 6,441 tokens, embedded in
  **both** `test_run` and `commit_revision` — is **70%** on its own.
- **Reliability.** The internal-tools review
  (`../builder-agent-reliability/tools-review/part-2-internal-tools.md`) found the same tools are a
  *double* cost: "each unused tool is context cost plus a wander target (the capstone showed extra
  visible tools derail runs)."

**These two costs need different fixes, and that is the central finding of this workspace.**
Shrinking schemas fixes the token cost completely and the wander cost not at all — the tool *count*
is unchanged. Reducing the advertised tool count fixes wander but, after the diet, buys only ~14%
more tokens. Conflating them is what made the first draft of this plan lead with the expensive,
risky lever instead of the cheap one.

It also scales the wrong way: adding a catalog op is a one-line data change that ships to every
playground agent unconditionally. But note the tail is *cheap* — ten ops for 2,120 tokens — so
catalog growth is not currently the pain. Schema *depth* is.

## Scope (this delivery)

- A **schema diet** for the ops carrying deep expanded schemas — `commit_revision`, `test_run`,
  then `query_spans`. This is the primary deliverable: ~84% of the token win, no runner change.
- A **token + reliability baseline** so before/after is measured, not asserted — done for tokens
  ([baseline.md](baseline.md)), still open for reliability and for prompt caching.
- A **designed, risk-registered meta-toolset** (`agenta_ops` + `agenta_op`) held behind an
  evidence gate, with its permission work scoped honestly ([security.md](security.md)).

## Out of scope

- **Skills.** Already progressive; a 64-token announcement. Untouched.
- **Op-set curation** (dropping the event pack from the default overlay). *Dropped, not deferred* —
  it saves ~1,052 tokens and risks the agent being unable to schedule when the user pivots
  mid-conversation. Revisit only with hard wander data.
- **External tool discovery (`discover_tools`).** It discovers *Composio* tools to wire into an
  agent; it stays as-is and is itself one of the ops we would disclose.
- **User / gateway / code / client tools.** The measured cost is platform ops.
- **Committed non-playground agents.** They advertise only what their author declared.
- **Dynamic real-name re-advertisement (M2).** A productionization option, evaluated only if the
  meta-toolset ships.

## Product language

- **Platform op** — an existing Agenta endpoint exposed to the agent as a tool, defined in the code
  catalog `op_catalog.py` (e.g. `commit_revision`, `query_spans`).
- **Advertised spec** — the `{name, description, inputSchema, …}` projection the model sees;
  distinct from the **private resolved spec** the runner executes from.
- **Schema diet** — replacing a deep, type-expanded `inputSchema` with a shallow one plus a pointer
  to on-demand prose guidance. Tool stays visible; only its manual shrinks.
- **Discovery meta-toolset** — the small fixed set (`agenta_ops`, `agenta_op`) that would stand in
  for the op schemas: list, describe-on-demand, invoke.
- **Disclosure** — moving an op's full schema out of the prompt (paid every turn) into a tool
  result (paid once, only when fetched).

## Success criteria

Rewritten 2026-07-26. The old criterion measured a no-op "hi" turn, which optimizes the cheapest
case nobody pays for; and it credited the meta-toolset with a win the diet delivers.

1. **Diet:** platform-op prompt cost drops from 18,353 to under ~3,000 tokens, with no capability
   loss — a lab agent still commits a valid config and runs a test.
2. **Session-level, not turn-level:** total platform-op tokens across a full build session
   (discover → wire → commit → test → schedule) drop materially. A no-op turn is *reported*, never
   the target.
3. **Caching answered:** we know whether these tokens are billed per turn or cached after the
   first, and the ROI of anything past the diet is restated against that answer.
4. **No safety regression:** self-targeting `$ctx` bindings and per-op approval behave exactly as
   today, verified per mutating op on **both** harness paths.
5. **Reliability measured, not assumed:** if the meta-toolset proceeds, it is justified by observed
   wander reduction on the lab matrix — the token case alone (~14%) does not carry it.
6. **Cost of laziness bounded** (meta-toolset only): ≤1 extra round-trip per distinct op used, a
   schema fetched at most once per op per conversation, and no net regression in session-level
   tokens once history-resident schemas are counted.
