# Open issues

Deferred TODOs and open questions for this project. Each entry carries enough context and
provenance to act on cold. See the `defer-todo` skill for the format.

## Open issues

### Tell the agent its own name, the session name, and whether this is the first turn

**Status:** open
**Added:** 2026-09-07
**Commit:** f676a77e01 (branch `feat/release-1153-platform-prompt`)
**Project:** [Agent platform instructions](./README.md)
**Source:** Platform prompt rewrite for release v0.115.3, review with Mahmoud

**The problem.** The platform prompt tells the agent two naming rules. Rename the agent with
`rename_agent` only while its name is still a placeholder such as "New agent". Name the
session with `rename_session` once, at the start, and never again. The agent cannot follow
either rule reliably, because the run gives it none of the facts the rules need. `read_config`
returns `parameters.agent` only, which holds no display name. The run request carries no
session name and no flag that says this is the first turn of the session. So the agent has to
guess whether the agent name is a placeholder, and it cannot tell a first turn from a later
turn after a cold start. The stock persona in `sdks/python/agenta/sdk/utils/types.py` works
around this with prose, and live QA on 2026-08-10 showed the model still forgetting the rule.

**Why it is deferred.** The prompt rewrite ships text only. Adding the three facts means a new
wire field from the API through the SDK to the runner, plus a place in the prompt to render
them, and that is its own change with its own tests.

**What to decide or do.** Add the agent display name, the session name, and a first-turn flag
to the run request, and render them in a short session-context block at the end of the
platform instructions. Then rewrite the two naming rules to read the facts instead of guessing:
"Your name is X. If X is a placeholder, rename yourself." and "This session has no name yet.
Name it in this turn." Keep the block out of the session fingerprint, the way the gateway
guidance is, so a session rename does not evict a warm session.
