# Agent-workflows QA session: workspace cleanup plan

Date: 2026-06-21. Repo: `/home/mahmoud/code/agenta` (GitButler workspace, branch
`gitbutler/workspace`). This is a read-only survey for the user to review before any
cleanup. Nothing here is committed, staged, or modified.

## Summary

The uncommitted tree is dominated by one effort that is NOT ours: the in-flight
`rivet -> sandbox-agent` rename and restructure, already partly committed in the
`chore/sandbox-agent-core` lane (HEAD sits on top of it). That rename touches almost
every `services/agent/**`, the SDK adapters, the Python agent service, hosting (compose,
k8s, railway), CI, and many existing design docs. On top of it ride a frontend
`AgentChatSlice` change and GitButler's own hook backups. Our QA session produced only
four kinds of change: (1) the Composio no-auth tools fix, which is already byte-identical
in PR #4785, so the workspace copies are pure duplicates to discard; (2) the QA docs and
new design-proposal folders, most of which are newer than what PR #4779 holds or are not
in #4779 at all, so they need a docs update; (3) the F-001 system-prompt fix, which lives
inside the renamed `services/agent/src/engines/sandbox_agent.ts` and is therefore tangled
with the rename, so it belongs on the rename lane, not on PR #4778 (which still ships the
old `rivet.ts`); (4) runner Docker tweaks, most of which already landed in PR #4778. The
net cleanup is small: discard the four Composio duplicates, land the QA/proposal docs,
and route the F-001 hunk onto the rename lane. Everything else stays with its owner.

## Key facts established by diffing (not assumed)

- The four Composio files (`dtos.py`, `providers/composio/adapter.py`, `service.py`,
  `tests/.../test_no_auth_connection.py`) are byte-for-byte identical to
  `origin/fix/composio-no-auth-toolkits` (PR #4785). Verified by `git hash-object` ==
  `git rev-parse origin/...:<file>` for all four.
- PR #4778 (`feat/agent-runner-engines`) still ships `services/agent/src/engines/rivet.ts`
  and the old `services/agent/test/` layout. The workspace has already renamed that to
  `services/agent/src/engines/sandbox_agent.ts` and moved tests to
  `services/agent/tests/unit/` (the `chore/sandbox-agent-core` lane, in HEAD). So the
  F-001 fix cannot land on #4778 cleanly; it must follow the rename.
- `services/agent/test/skills.test.ts` and `services/agent/test/extension-tools.test.ts`
  do not exist at those paths anymore. The whole `services/agent/test/` dir is gone
  (shown as deleted), replaced by `services/agent/tests/unit/**`, which is already
  committed in HEAD. `extension-tools.test.ts` now lives at
  `services/agent/tests/unit/extension-tools.test.ts`, rewritten for vitest. The git
  status snapshot in the task prompt was stale on this point.
- The QA docs that ARE in #4779 (`qa/README.md`, `qa/matrix.md`, `qa/findings.md`,
  `qa/regression-*.md`, `qa/scripts/*`) still have large workspace diffs vs #4779
  (200-360 lines each). #4779 holds an older snapshot; the workspace holds our newer QA
  content. These are real content updates, not rename noise.
- The proposal folders `skills-config`, `model-config`, `harness-capabilities`,
  `code-tool-sandbox`, plus `qa/implementation-plan.md` and `feature-matrix-test.md`, are
  in no lane and not in #4779. They are purely uncommitted, ours, and need a home.
- `e4_local_sdk.py` (named in the task brief) does not exist under `qa/scripts/`. Only
  `run_matrix.py` and `mcp_qa_server.mjs` are there.
- `code-tool-sandbox/` has two extra files beyond the brief's list: `security-review.md`
  and `status.md` (both ours).
- `.agents/skills/**` is gitignored and does not appear in status; not chased.

## Classification table (grouped by destination)

### Discard as duplicate of PR #4785

| File / group | Owner | Already landed | Destination | Notes |
|---|---|---|---|---|
| `api/oss/src/core/tools/dtos.py` | ours | yes, #4785 | discard (duplicate of #4785) | hash-identical to PR branch |
| `api/oss/src/core/tools/providers/composio/adapter.py` | ours | yes, #4785 | discard (duplicate of #4785) | hash-identical |
| `api/oss/src/core/tools/service.py` | ours | yes, #4785 | discard (duplicate of #4785) | hash-identical |
| `api/oss/tests/pytest/unit/tools/test_no_auth_connection.py` | ours | yes, #4785 | discard (duplicate of #4785) | untracked here, but content == PR #4785 blob |

### Land in a docs update (new docs PR, or update #4779)

| File / group | Owner | Already landed | Destination | Notes |
|---|---|---|---|---|
| `docs/design/agent-workflows/qa/README.md`, `matrix.md`, `findings.md`, `regression-testing-research.md`, `regression-skill-DRAFT.md` | ours | partial: older copy in #4779 | update #4779 (or new docs PR) | workspace is newer (F-012/13/14, F-008 downgrade); 200-360 line diffs vs #4779 |
| `docs/design/agent-workflows/qa/scripts/run_matrix.py`, `mcp_qa_server.mjs` | ours | partial: older copy in #4779 | update #4779 | workspace newer; real content diffs |
| `docs/design/agent-workflows/qa/implementation-plan.md` | ours | no | new docs PR / #4779 | not in #4779 |
| `docs/design/agent-workflows/qa/runs/**` (21 json) | ours | yes, #4779 | likely discard / no-op | all 21 already in #4779; confirm no content drift before re-landing |
| `docs/design/agent-workflows/skills-config/**` | ours | no | new docs PR / #4779 | proposal folder, in no lane |
| `docs/design/agent-workflows/model-config/**` | ours | no | new docs PR / #4779 | proposal folder, in no lane |
| `docs/design/agent-workflows/harness-capabilities/**` | ours | no | new docs PR / #4779 | proposal folder, in no lane |
| `docs/design/agent-workflows/code-tool-sandbox/**` | ours | no | new docs PR / #4779 | proposal folder incl. `explainer.md`, `security-review.md`, `status.md` |
| `docs/design/agent-workflows/feature-matrix-test.md` | ours | no | new docs PR / #4779 | live-test report from the prior session; in no lane |
| `docs/design/agent-workflows/qa/cleanup-plan.md` (this file) | ours | no | new docs PR / #4779 (optional) | survey artifact; optional to commit |

### Mixed: needs care (our hunk tangled with the rename)

| File / group | Owner | Already landed | Destination | Notes |
|---|---|---|---|---|
| `services/agent/src/engines/sandbox_agent.ts` | mixed (rename = other, F-001 = ours) | no | F-001 hunk -> `chore/sandbox-agent-core` lane (or a PR stacked on it) | F-001 = the `writeSystemPromptLocal` / `uploadSystemPromptToSandbox` additions + the `system`/`append_system` wiring (~lines 197-236, 907-930). Cannot go to #4778 (#4778 still has `rivet.ts`). The rename body itself is OTHER. |
| `hosting/docker-compose/ee/docker-compose.dev.yml` | mixed (rename = other, MCP-flag = ours) | MCP flag: yes, in #4776 | leave the rename for its owner; our `AGENTA_AGENT_ENABLE_MCP` already in #4776 | WS replaces `agent-pi`->`sandbox-agent`, `AGENTA_AGENT_PI_URL`->`AGENTA_RUNNER_URL`, drops the RUNTIME/HARNESS/SANDBOX vars (all rename). Our MCP flag survives and is already in #4776. Nothing of ours to add. |
| `services/agent/docker/Dockerfile` | mixed mostly other | python3: yes, in #4778 | leave for rename owner | WS-vs-#4778 delta is only `USER node` (restructure), not ours. python3 already in #4778. |
| `services/agent/docker/Dockerfile.dev` | other (rename + skills COPY) | dev rebuild + python3: yes, in #4778 | leave for rename owner | WS-vs-#4778 delta is rename text + `COPY skills ./skills` (AgentaHarness), not a QA fix |

### Leave for owner (the rivet -> sandbox-agent rename / restructure)

All OTHER. None contain a QA-session change. These belong to the
`chore/sandbox-agent-core` lane (or the relevant feature lane) and should stay there.

| File / group | Owner | Destination | Notes |
|---|---|---|---|
| `services/agent/src/**` except the engines above (`cli.ts`, `server.ts`, `extensions/agenta.ts`, `protocol.ts`, `responder.ts`, `tools/*.ts`, `tracing/otel.ts`), `engines/pi.ts` | other | leave (rename lane) | `runRivet`->`runSandboxAgent`, engine string `rivet`->`sandbox-agent`, env renames; `cli.ts`/`server.ts` also carry the TS-structure testability refactor |
| `services/agent/src/engines/skills.ts` (untracked) | other | leave (rename lane) | shared bundled-skill resolver (AGENTA-on-sandbox-agent) |
| `services/agent/sandbox-images/**` (untracked) | other | leave (rename lane) | Daytona runner image assets |
| `services/agent/test/*` (all deleted) | other | leave (rename lane) | old test dir removed; replaced by `tests/unit/**` (already in HEAD) |
| `services/agent/{README.md, docker/README.md, package.json, pnpm-lock.yaml, tsconfig.json}` | other | leave (rename lane) | rename + vitest/restructure |
| `sdks/python/agenta/sdk/agents/**` (`__init__.py`, `adapters/*`, `dtos.py`, `interfaces.py`, `utils/*`), `sdks/python/agenta/__init__.py` | other | leave (rename lane) | `RivetBackend`->`SandboxAgentBackend`, env renames |
| `sdks/python/agenta/sdk/agents/adapters/rivet.py` (D) -> `sandbox_agent.py` (untracked R) | other | leave (rename lane) | the SDK side of the rename (the two `R` entries in unassigned) |
| `sdks/python/oss/tests/pytest/unit/agents/**` | other | leave (rename lane) | rename-driven test updates + AGENTA-on-sandbox-agent assertion |
| `services/oss/src/agent/{app.py, config.py, secrets.py}`, `services/oss/tests/.../test_select_backend.py` | other | leave (rename lane) | `select_backend` collapses to always `SandboxAgentBackend`; env + test rewrite |
| `hosting/**` (compose `.gh.yml` + env examples, all k8s helm/values incl. new `sandbox-agent-{deployment,service}.yaml`, all railway scripts + `sandbox-agent/Dockerfile`) | other | leave (rename lane) | adds the `sandbox-agent` service + `AGENTA_RUNNER_URL` contract |
| `.github/workflows/{12,42,43}-*.yml` | other | leave (rename lane) | adds runner unit-test job + `agenta-sandbox-agent` image build/deploy |
| `docs/docs/self-host/guides/04-deploy-on-railway.mdx`, `08-custom-agent-runner-images.mdx` (untracked) | other | leave (rename lane) | sandbox-agent runner self-host docs |
| Modified existing `docs/design/agent-workflows/*.md` (`README.md`, `adapters/{agenta,claude-code,pi}.md`, `architecture.md`, `ground-truth.md`, `implementation-review.md`, `meeting-alignment.md`, `ports-and-adapters.md`, `pr-stack.md`, `protocol.md`, `sessions.md`, `status.md`, `sdk-local-tools/*`) | other | leave (rename lane) | dominated by rivet->sandbox-agent rename; a couple cite the QA matrix but are not QA-authored |
| `docs/design/agent-workflows/provider-model-auth/**`, `typescript-structure/**` (untracked) | other | leave for owner | separate design workspaces, not ours |
| `web/oss/src/components/AgentChatSlice/state/sessions.ts` | other | leave (AgentChatSlice lane) | `crypto.randomUUID()`->`generateId()` import swap |
| `.husky/{post-checkout, pre-commit}` (M), `.husky/{post-checkout, pre-commit}-user` (untracked) | other (GitButler) | leave for GitButler | `GITBUTLER_MANAGED_HOOK_V1`; the `*-user` files are GitButler's backups of the originals |
| `.gitignore` (M) | other | leave (rename lane) | adds `services/agent/test-results/` and `coverage/` ignores |

## Recommended cleanup actions (for user approval)

1. Discard the four Composio files. They are byte-identical to PR #4785: revert
   `api/oss/src/core/tools/{dtos.py, providers/composio/adapter.py, service.py}` to HEAD
   and delete the untracked `api/oss/tests/pytest/unit/tools/test_no_auth_connection.py`.
   Confirm #4785 is the surviving copy first.
2. Land the QA + proposal docs. Either refresh PR #4779 with the newer workspace versions
   of the in-#4779 qa docs and scripts, and add the not-yet-in-#4779 items
   (`qa/implementation-plan.md`, the four proposal folders, `feature-matrix-test.md`), or
   open one new docs PR for all of it. The 21 `qa/runs/**` json files are already in
   #4779; only re-land them if their content drifted.
3. Route the F-001 system-prompt fix onto the rename lane. Stage only the
   `writeSystemPromptLocal` / `uploadSystemPromptToSandbox` hunks of
   `services/agent/src/engines/sandbox_agent.ts` onto `chore/sandbox-agent-core` (or a PR
   stacked on it), since #4778 still ships `rivet.ts` and cannot take it cleanly. Do not
   touch the rename body.
4. Leave everything in the "leave for owner" group untouched. It is the rename/restructure
   lane, the frontend AgentChatSlice lane, GitButler hooks, or other people's design docs.
   Our runner Docker fixes (python3, dev rebuild) and our MCP compose flag already landed
   in #4778 and #4776; the only remaining workspace deltas on those files are the rename,
   which is not ours.
5. Optional: decide whether to commit this `cleanup-plan.md` itself with the docs in step 2
   or leave it as a local survey artifact.
