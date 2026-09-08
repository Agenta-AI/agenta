# Fable prompt

Build a working exploratory implementation of hosted ChatGPT subscriptions in Agenta. Research,
spikes, backend work, and product integration should proceed in parallel. There is no timebox. Do
not stop with a plan, recommendation, or mocked demonstration. We may rebuild parts after learning
more, but implement straightforward product functionality well from the start.

## Workspace and instructions

Starting PR: https://github.com/Agenta-AI/agenta/pull/6622

On Mahmoud's machine, the integration worktree is:
`/home/mahmoud/code/agenta-2-worktrees/hosted-subscriptions`

Local branch: `spike/hosted-subscription-exploration`
PR branch: `agent/hosted-subscription-connections-plan-20260907`

Mahmoud explicitly authorized a worktree for this work. Use ordinary Git inside the dedicated
worktree; do not initialize GitButler there or mutate the shared `agenta-2` workspace. If you run in
a different environment, fetch the current PR branch into your own checkout and record its commit
and location. The local path above is not a requirement that your environment have the same path.

Read the root AGENTS.md, the onboarding and simplify skills, and applicable nested instructions
before working in an area. Read these files under `docs/design/hosted-subscription-connections/`:

1. `requirements.md`: the user's product requirements.
2. `working-research.md`: current implementation direction and experiments.
3. `communication-log.md`: asynchronous handoff protocol and messages.
4. `status.md`: current work and ownership.

`technical-inferences.md` and `design-questions.md` are AI analysis, not extra user requirements.
`v0/` is a good historical starting point that may miss important things. Its one-active-run rule
and Grok-first-release scope do not apply. The user has authorized exploratory implementation in
this handoff; do not stop at a design-only approval gate for work already covered here.

## Required result

- Sign in to ChatGPT from Agenta's UI.
- Show the subscription in the existing model list, as mounted subscriptions appear today.
- Use it across multiple agents and concurrent sessions.
- Choose natural project or organization scope after inspecting existing conventions.
- Working support through either Codex or Pi is sufficient. Supporting both is optional.
- Build refresh recovery and a visible re-login path when user authorization is actually needed.
- Do not implement Grok. Consider future extension lightly, without building a generic framework.

Do not wait for a final schema or architecture to implement simple parts. Make reasonable,
reversible choices and record them. The desired endpoint is runnable application code, meaningful
validation, and repeatable experiments, not merely a recommendation.

## Parallel tracks

Use parallel agents or equivalent independent tasks for:

- Source and internet research into pinned Codex and Pi authentication behavior.
- Shared-state and concurrent-refresh experiments.
- UI login, connection persistence/scope, model picker, execution, and re-login integration.
- Real integration validation and incorporation of Codex review feedback.
- And any other thing you thing make sense to paralellize (say reserach grok, implement htings)

## Architecture direction

Most likely, each session's harness should continue to perform refresh. Explore, in order of
initial preference rather than as a mandatory sequence

1. Native auth files in shared mounted storage, with reload and retry after a recoverable race.
2. Other ways to share changes: database-backed state, direct object storage, or supported hooks
   for publishing/reloading credentials. Pull-on-demand may be enough; broadcasting is optional.
3. A narrow coordination component if the simpler approaches fail. It may only synchronize state;
   it need not own provider refresh. Investigate a refresh-owning service only when justified.
4. One long-lived authentication-owning process serving concurrent conversations, as the last
   option because its lifecycle and multiplexing may be complex.

A failed competing refresh is acceptable if the loser automatically obtains usable credentials
and continues. Do not require locks, a broker, a dedicated volume, or zero races without evidence.
Do not serialize complete runs to avoid the problem.

The storage discussion is about S3-backed mounts in Daytona and SeaweedFS in the existing setup.
Inspect the actual storage configuration, filesystem adapter, caching, and persistence semantics.
Do not substitute a local-directory test and claim it proves the remote-mount behavior. 

## Research and experiments

Inspect exact installed versions first; record newer upstream behavior separately. Learn login
interfaces, credential formats, refresh triggers, in-memory caches, cross-process coordination,
write behavior, retry/reload paths, external credential hooks, and error propagation. Source and
issues describe client behavior; provider-side guarantees need official documentation or live
observations. Both clients are open source; the ChatGPT authentication server is not.

Run independent concurrent sessions, force or provoke renewal, delay state visibility, interrupt a
worker, and observe recovery. Include what happens when the provider accepts renewal but the new
credentials are not yet saved. Compare alternatives with the same scenarios.

Build the UI path for actual required re-login. Determine how the backend detects it, how the UI
learns about it, what the user clicks, and whether existing conversations can continue after a new
login. Do not classify every network error or stale-token failure as needing user authorization.

Use real provider authorization where available. Request the human authorization step when needed,
while continuing work that does not depend on it. Use controlled responses for deterministic fault
coverage, but label simulated and real-provider results separately. Never publish tokens, raw auth
files, or secrets in logs, screenshots, commits, or the handoff documents.

## Communication with Codex and Mahmoud

Use `communication-log.md` for non-blocking updates and replies. Read it at work boundaries, report
concrete results with file/commit references, and continue independent work while questions are
pending. If you do not share a filesystem, Mahmoud will relay the messages or commit references;
file edits alone do not notify another environment. Do not assume Codex is continuously watching.

Codex will inspect code and evidence, try the application when access is available, and return
focused feedback. Address feedback and report the result without waiting for a new high-level plan.
When an answer is necessary for a dependent action, leave that action pending and continue other
tracks. Do not treat silence as a decision.

Keep `status.md` current with ownership, runnable commands, actual validation results, and next work.
Put source citations, experiments, and implementation findings in `working-research.md` or linked
artifacts. Preserve the user's requirements and historical v0 documents.

Commit reviewable changes in your own branch. Coordinate publication with the integration owner
through the log; do not overwrite another worker's PR head. A production deployment is not part of
this handoff. For design Markdown edits, check content and links; do not run Docusaurus. For code,
use the relevant repository checks and validate the real flow.

Continue until there is a working integrated implementation through one harness, with evidence for
concurrent use, renewal recovery, and re-login. Clearly identify anything that could not be proven
because credentials, infrastructure, or human authorization were unavailable.
