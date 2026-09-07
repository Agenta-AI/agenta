# Status

## Current state

Implementation approved on 2026-09-04 for the reduced cleanup in [plan.md](./plan.md).
PR: #6365. Target: `release/v0.114.4`.

The design now builds on the gateway-guidance separation already in the release.
Instruction digests, database changes, new restart rules, and new harness delivery
mechanisms are out of scope.

## Progress

- Design updated to the approved scope.
- SDK and runner implementation complete. The SDK sends the shared string; the
  runner retains existing delivery and accepts the legacy input during rollout.
- Independent correctness and maintainability reviews found no blocking issues.
- SDK adapter/wire checks: 110 passed. Full SDK agent unit suite: 1,194 passed,
  4 skipped. These ran with the existing development virtual environment; its lock
  differs from the release snapshot. The subsequent locked SDK CI suite also passed.
- Runner unit suite: 2,617 passed. TypeScript checks passed. Runner dependency lock
  matches the existing installed development dependencies.
- Documentation production build passed. Changed runner files formatted with the
  repository's installed Prettier.
- Locked CI passed SDK, API, services, and runner unit suites, plus runner integration
  and acceptance suites, at implementation commit `cff860e45e`.
- Pi live QA passed on the changed SDK and runner: fresh author instructions,
  unchanged continuation, edited author instructions, and a fresh control. No stream
  errors or silent turns occurred. Runner logs confirmed warm reuse for the unchanged
  turn and a rebuild for the author edit. Session: `1ce65cf6-32e9-47d1-be68-fd3b9fe0d287`.
- Claude, Codex, and gateway live QA remain unverified because existing test keys were
  rejected by the available deployments. Automatic approval review blocked copying
  provider keys into a new test vault without explicit permission. No keys were copied.
- The two isolated QA containers were stopped and removed, and three QA workflows
  were archived. The empty ephemeral account/project remains because the existing
  account fixture has no teardown. Existing deployments were not changed.

## Workspace

Implementation uses an isolated source copy of release commit
`76f7b0b6f0795c2e792ab4a4403e3e01303f228c`. The shared checkout contains unrelated
website conflicts. Publication must preserve those files and the shared index.

## 2026-09-07: the base text became the platform prompt

Branch `feat/release-1153-platform-prompt`, target `release/v0.115.3`.

- `AGENTA_PLATFORM_BASE` grew from a four-sentence stub into the full platform prompt: what
  Agenta is, the coworker persona, how the agent works and talks, the three ask gates, files
  and storage, credentials, GitHub rules, and the harness features that do not work here. A
  second constant, `AGENTA_CONFIG_SECTIONS`, holds the parts that name configuration tools
  (task against configuration intent, the configuration itself, memory, automations, naming).
  `compose_platform_instructions` includes it only when the run offers `commit_revision`.
- The runner's fenced block dropped the two config sentences the prompt now owns (the rendered
  file is a copy; skills live in the configuration). Its file-citation sentence now asks for a
  path relative to the working directory, because the chat's link gate cannot open an absolute
  sandbox path. The mount paragraph and the codex rebuttal stay.
- `request_secret` ships through the build-kit overlay beside `request_connection` and
  `request_input`, and its usage guidance moved into the tool description.
- Open: the agent still cannot see its own name, the session name, or a first-turn flag. See
  [open-issues.md](./open-issues.md).
- The prompt gained an "Installing tools" section that matches the `agent-files/.tools`
  restore hook from #6639: no `apt` or `sudo`, the shipped tool list, static binaries in
  `agent-files/.tools/bin/`, environments rebuilt on local disk by `setup.sh`, and tools
  called as `.tools/bin/<tool>` from the working directory. It assumes #5796 lands in the
  same release.
- Codex review (2026-09-07) on the combined change: the ask gates were narrowed to changes
  outside the working directory, the refusal rule now distinguishes a policy refusal from a
  refusal that names a fix, the link rule no longer claims an absolute path never opens, the
  rendered-copy rule names the instruction and skill files only, and the storage section
  hedges on an unavailable durable folder. The runner's mount paragraph no longer forbids
  storing a preference in the instructions, which the prompt's Memory section requires. The
  SDK resolver collapses two identical copies of a reserved client tool, so a revision that
  embedded `request_secret` by hand before it joined the kit still runs.

## 2026-09-07: the agent can see its own name and the session's

Branch `feat/release-1153-session-context`, stacked on `feat/release-1153-platform-prompt`.

- A `sessionContext` field carries three facts from the API to the prompt: the agent's display
  name, the session's name, and whether this is the first turn. The API stamps them on
  `request.meta` in `_prepare_invoke`, the one prelude both `invoke_workflow` and
  `invoke_workflow_detached` share, so a UI turn, a HITL resume, and a trigger fire are covered
  by one stamp. It is gated to agent runs by the revision URI.
- The SDK carries them as `SessionContext` on `SessionConfig`, renders them as a final
  "## This session" block, and emits `sessionContext` on the `/run` wire. The block renders only
  when the run offers a rename tool.
- The "## Names" rule now reads those facts instead of asking the model to guess whether its own
  name looks like a placeholder. The placeholder test itself moved into
  `is_placeholder_agent_name`.
- The field is outside the runner's `configFingerprint` and every desired-state facet, so an
  agent obeying the rule and calling `rename_session` does not evict its own warm sandbox.
- `userName`, `timezone` and `localTime` are declared and reserved. They are not populated and
  not rendered. Filling them is a later change with no wire migration.
