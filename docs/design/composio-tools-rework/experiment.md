# Experiments

Two checks to run before committing to the new design. Neither has run yet. This
file is a proposal, not a result.

## 1. Can the smallest models use search-then-execute?

The new design replaces a flat list of tool schemas with two tools: a search tool
and an execute tool. The model must first search for the action, read the returned
schema, then call execute with a slug and arguments. That extra step is indirection
the flat list does not have.

**Hypothesis.** The largest models handle the indirection with no loss. The
smallest, cheapest models may struggle: they may skip the search step, execute a
slug they never searched for, or loop on search without ever executing. If so, the
new pattern would cost accuracy exactly where cost pressure pushes users toward
small models.

**Models.** The cheapest model in each harness family:

| Model            | Harness family |
|------------------|----------------|
| Haiku            | Claude         |
| Luna             | Codex          |
| DeepSeek V4 Flash| Pi             |

Test each model on the harness that hosts it.

**Tasks.** A small set of representative tool jobs, each with a checkable side
effect:

- Create a GitHub issue titled a given string in a test repository.
- Post a Slack message with a given body to a test channel.
- Find and read the most recent issue in a test repository, then report its title.

**Method.** Run each task two ways against the same test connections:

- **Old (flat list).** The allowed action schemas are listed directly, as today.
- **New (search + execute).** Only the search and execute tools are exposed.

Run several trials per cell. Measure two numbers: the task success rate (did the
checked side effect happen, or the correct value get reported) and the number of
tool calls the model made to get there.

**What a pass looks like.** For each model, the new mode reaches a success rate
within a small margin of the old mode, without a large jump in tool calls. That
would show the indirection is affordable even for small models.

**What would make us reconsider.** A clear success-rate drop or a runaway tool-call
count in the new mode on any small model. Two responses are possible: keep both
modes and pick the flat list for small models under a schema-count threshold, or
improve the search tool's output (tighter results, clearer schemas) and retest. A
drop on the largest models would instead question the pattern itself.

## 2. Spike: does a searched tool execute cleanly at the pinned version?

The design pins the Composio calls to the latest toolkit version so a slug that
search returns is one execute can run (section 8 of `design.md`). This spike checks
that assumption against the live Composio key. The orchestrator runs it; it is
described here, not run.

**Steps.**

1. Call `COMPOSIO_SEARCH_TOOLS` for a common intent (for example "create a GitHub
   issue"), with the toolkit version pinned to latest (Composio API v3.1).
2. Take one action slug from the returned results, and read its input schema from
   the same response.
3. Execute that slug with valid arguments against a test connection, at the same
   pinned latest version.
4. Confirm the execute call succeeds and returns a real result, not a version or
   not-found error.

**What it confirms.** A found tool executes cleanly when both calls pin to latest,
so the search-versus-execute mismatch (#5174) does not resurface and the rare soft
failure the design tolerates is in fact rare. A failure here means the pin does not
fully align the two calls, and the soft-failure path must carry more weight than
the design assumes.

Use test connections and test channels only. Do not put real Composio identifiers
(account, session, or key values, or real project UUIDs) in this file or in the
spike output that gets shared.
