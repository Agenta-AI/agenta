# Open issues

Deferred TODOs and open questions for this project. Each entry carries enough context and
provenance to act on cold. See the `defer-todo` skill for the format.

## Open issues

### A live approval resume carries the parked turn's context, not a fresh one

**Status:** open
**Added:** 2026-09-07
**Commit:** dfbb856105 (branch `feat/release-1153-session-context`)
**Project:** [Agent platform instructions](./README.md)
**Source:** Codex review of PR [#6638](https://github.com/Agenta-AI/agenta/pull/6638)

**The problem.** Per-turn context reaches the harness as the `turnContext` string on a fresh
prompt. A live approval resume sends no fresh prompt. In
`services/runner/src/engines/sandbox_agent/run-turn.ts` (around line 1144) the resume answers
the parked gate on the SAME harness session and continues the ORIGINAL, still-pending prompt
promise, so the tool runs with its original byte-exact arguments. The API stamps a new
`session_context` on the resume request and the SDK renders a new `turnContext`, and the
harness never sees it. If the session was named or the agent was renamed while the turn was
parked, the resumed turn keeps working from the older facts.

**Why it is deferred.** The parked turn's snapshot is the authoritative one for that turn. The
whole point of a live resume is that the tool call runs with the arguments the person approved,
in the context the person read when they approved it. Delivering a competing prompt into a
parked session is not safe: a second prompt on the same session races the pending one, and the
harnesses do not all define that. The blast radius is also small. The stale facts are the
session name and the placeholder flag, and they can only go stale inside one parked turn.

**What to decide.** Either accept that a parked turn keeps its opening snapshot and say so in
the design doc, or find a delivery channel that is not a prompt. The candidate is to fold the
fresh context into the resume's own text where a harness accepts one, and to leave the pure
`respondPermission` path alone. Settle it before anything time-sensitive, such as the current
time or the user's name, joins the context block. Those go stale in every parked turn, not
just a renamed one. See [#6636](https://github.com/Agenta-AI/agenta/issues/6636).

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
