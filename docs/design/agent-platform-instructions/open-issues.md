# Open issues

Deferred TODOs and open questions for this project. Each entry carries enough context and
provenance to act on cold. See the `defer-todo` skill for the format.

## Open issues

### Tell the agent its own name, the session name, and whether this is the first turn

**Status:** resolved (2026-09-07, per-turn context delivery)
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

**How it was resolved.** The API supplies typed facts on `request.meta.session_context` in
its shared invoke prelude. The SDK renders a `turnContext` string containing the current facts
and naming instructions for the tools this run offers. The runner adds the string to each new
harness prompt, including warm continuations, rather than installing it as environment-level
instructions. The first-turn flag remains; context does not change the environment fingerprint
or the persisted user message. Branch `feat/release-1153-session-context`.

User name, timezone, and time calculated at execution are tracked in
[#6636](https://github.com/Agenta-AI/agenta/issues/6636). They can extend the API/SDK facts and
renderer while using the same text-only runner field.
