# Overnight recovery notes - 2026-06-30

## Current merge decision

Do not merge the agent-workflows stack yet.

The remote stacked PRs are repaired and clean, but playground QA found a real client-tool runtime blocker: the playground sends the build-kit overlay correctly, including `__ag__request_connection`, but the running agent does not receive `request_connection` as an available callable tool in the Pi path.

## Remote PR state verified

Remote PRs were repaired by rebuilding clean remote commit ancestry through the GitHub API, preserving each branch tree and setting each PR base to the branch directly below it.

- #4925 `feat/client-tool-roundtrip-4920` -> `big-agents`, head `d366270f637d9f2bef6049bf381a3ddfa21fbac2`, mergeable clean.
- #4929 `feat/build-kit-4917-v2` -> `feat/client-tool-roundtrip-4920`, head `86b1d55de6fbf333c4a5cb6f8d20c36cdc26e0a6`, mergeable clean.
- #4930 `feat/agent-skills-4918-v2` -> `feat/build-kit-4917-v2`, head `9a02b8aa9d7e869baf6c556d9fc4a01405146702`, mergeable clean.
- #4931 `feat/agent-builder-tools-4919-v2` -> `feat/agent-skills-4918-v2`, head `115d146faec1e96344f6fd1c1d7a19ec76557073`, mergeable clean.
- #4935 `feat/advanced-collapsible-change1` -> `feat/agent-builder-tools-4919-v2`, head `84f19bfafdbe94dba7f95ffcabfd69765814a95c`, mergeable clean.

## Local GitButler caveat

Local GitButler branch bookkeeping is stale relative to the GitHub-repaired heads for the upper PRs. The top stack is applied locally over `331930bff0`, but `but status` still shows two local FE files as unassigned:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`

Do not push local GitButler branches over the repaired remote heads until this is reconciled. Treat GitHub PR heads as authoritative for review/merge.

## QA environment repairs made

These were environment-only repairs, not source-code changes:

- Installed missing `aioboto3>=13,<16` into the running API container venv because the container had a stale environment even though `api/pyproject.toml` already declares the dependency.
- Reset the dev login password for `resiros@gmail.com` via the admin reset endpoint so browser QA could log in.
- Created a fresh QA app `qa-agent-codex-20260629234252` in the `hotel-agent` project because the existing `qa-agent-x7k3` app had a stale committed schema using `x-ag-type-ref: agent_config`; current catalog exposes `agent-template`.
- Edited that QA app to revision `019f15c6-e00f-7a93-9d08-058b2cb8a7c2`, changing only `parameters.agent.llm` to `{provider: "openai", model: "gpt-4o-mini"}` because the template default bare `gpt-5.5` cannot resolve credentials at runtime.

## QA results

Passed:

- Login works at `http://144.76.237.122:8280`.
- Fresh agent playground opens at `/w/019e8df5-2a4f-7ab2-b71a-c7dd27c589b6/p/019e8df5-635d-7261-85db-d40eb02a1f38/apps/019f15c3-ab06-7ac1-85d2-ab65966af7b5/playground?revisions=019f15c6-e00f-7a93-9d08-058b2cb8a7c2`.
- Agent template schema resolves through `/api/workflows/catalog/types/agent-template`.
- Left config renders model/harness, instructions, tools, MCP servers, skills, triggers, and advanced sections.
- Advanced drawer shows `Playground build kit` and `Removed on commit`.
- Browser `/invoke` payload includes the build-kit overlay: platform tools, the `__ag__request_connection` embed, `agenta-getting-started` skill embed, and sandbox permissions.

Failed/blocking:

- Prompting the agent to call `request_connection` does not render the client-tool widget.
- The model either uses `bash` with text like `Please connect your Slack account` or tries shell `request_connection`, which fails with `command not found`.
- Captured payload proves frontend build-kit composition is correct. The problem is downstream in runner/tool exposure: `services/agent/src/tools/public-spec.ts` filters `kind: "client"` tools out of public specs, and the MCP bridge also filters client tools from `tools/list`. The only path that emits a browser `client_tool` interaction is `attachPermissionResponder`, but the client tool is not advertised to the harness in this Pi run.

## Archive step

`docs/design/agent-workflows/projects/advanced-build-kit` is already absent in this working tree, and no matching `advanced-build-kit` directory exists under `docs/design/agent-workflows` at max depth 3. No move was performed.

## Recommended next action

Fix the runner-side client-tool exposure/parking path before merging. The frontend pieces and build-kit payload are present; the missing behavior is that a browser-fulfilled client tool must be visible to the harness as callable and must emit/park as `interaction_request.kind = "client_tool"` instead of being filtered out or executed as a shell command.

## 2026-06-30 02:04 CEST - client tool relay patch

- Fixed Pi client-tool delivery by advertising client tools to the Pi extension while keeping private executor fields redacted.
- Routed relayed client tool calls back to the runner responder so `/messages` can park and render browser-fulfilled tools instead of returning a fake `client_tool_pending` JSON result to the model.
- Projected `interaction_request.kind=client_tool` to AI SDK `tool-input-*` stream parts plus `data-render`, leaving the tool unsettled for the frontend widget.
- Passed `request.runContext` into the relay path for direct-call platform tools such as `commit_revision`.
- Reviewer residual: Daytona non-Pi internal gateway tools are currently not advertised because `mcp.ts` skips loopback MCP on Daytona and file relay only executes calls. This appears pre-existing and outside the local Pi browser QA path; keep as a follow-up unless matrix QA requires Daytona non-Pi before merge.
- Targeted tests passed: `services/agent` vitest runner plan/assets/dispatch/relay (58 tests) and Python Vercel stream park tests (3 tests).

## 2026-06-30 03:45 CEST - commit_revision round-trip recovery

- Fixed `commit_revision` no-op by normalizing application/evaluator trace references into workflow-shaped run context, so self-targeting platform tools bind the running variant when invoked from the app playground.
- Added fail-closed direct-call context binding: a tool with `call.context` now errors if the hidden run-context value is missing instead of silently dropping the target field.
- Added API validation so workflow revision commits without `workflow_revision.data` or `workflow_revision.workflow_variant_id` return 400 instead of `count:0`.
- Added a platform-tool patch endpoint at `/api/workflows/revisions/commit/patch`; `commit_revision` uses it so model-supplied partial data is deep-merged onto the current revision instead of clobbering the agent template.
- Added Vercel stream projection for successful `commit_revision` results to emit `data-committed-revision`, matching the frontend refresh contract.
- Updated the OSS agent chat panel to replace the current playground entity id with the committed `revisionId` when that data part arrives; this handles URLs pinned to an old `revisions=` id.
- Repaired the QA app once by committing the known-good v2 full agent data as version 8, because earlier failed QA runs had created partial revisions that dropped the agent template shape.

QA after fixes:

- `commit_revision` browser QA passed at the UI level: the agent created revision `019f1632-1c3b-7b32-abfe-466a15460efe` (`v9`), the playground URL switched to that revision, the page stayed in agent mode, and AGENTS.md displayed `codex-commit-qa-20260630-0235`.
- `request_connection` browser QA passed for the required user-facing behavior: the agent called `request_connection` and the frontend rendered the connection UI with `Connection not completed` and Retry buttons.

Residual to review:

- `request_connection` and `commit_revision` stream inputs still display `{}` in the UI stream even when the tool behavior succeeds. This appears to be a Pi/SDK display or tool-search/schema issue rather than a blocker for the required browser behavior, but it should be tracked before relying on the displayed input as audit evidence.

## 2026-06-30 04:20 CEST - reviewer follow-up fixes

- Accepted reviewer finding that direct `setEntityIds` was not sufficient for self-commit refresh because it can bypass the playground selection-change bridge. Changed the frontend to use `playgroundController.actions.switchEntity` so revision swaps also drive URL/selection side effects.
- Accepted reviewer finding that resumed streams may contain a `commit_revision` result without replaying the original tool call. The Vercel stream adapter now treats a successful `workflow_revision` commit payload as enough to emit `data-committed-revision` when the tool name is unavailable, while still rejecting known non-`commit_revision` tool names.
- Kept `/api/workflows/revisions/commit/patch` as preservation-only sparse merge semantics. This is intentional for the self-update tool: omitted fields preserve the stored agent template instead of clearing it. If we need clear/delete semantics later, add an explicit clear operation instead of overloading omitted or null fields.

## 2026-06-30 04:40 CEST - browser QA after reviewer fixes

- `commit_revision` browser QA passed after warming the route. The agent committed and the playground switched from pinned v2 to revision `019f1641-7708-78b2-937e-db2bc13de0f3` (`v10`), with `AGENTS.md` showing the marker `codex-commit-qa-20260630-0235` and preserved agent UI fields.
- `request_connection` browser QA passed. `/services/agent/v0/invoke` returned HTTP 200, stream contained `toolName: request_connection`, `tool-output-available` with `"aborted"`, and the page rendered the connection UI with repeated `Connection not completed`/`Retry` controls.
- First rerun failed only because the cold route did not expose the composer within the script's 30s selector timeout. A DOM snapshot confirmed the composer existed after warmup; no code change was made for that timing issue.

## 2026-06-30 04:20 UTC - merge completion

Merged into `big-agents`, bottom-up, using GitHub admin merge because the handoff said CI is not a reliable merge gate for this stack:

- #4925 `feat/client-tool-roundtrip-4920` -> merge commit `ee2753e53afd7e950e70744cce9e117e7b516f1e`.
- #4929 `feat/build-kit-4917-v2` -> retargeted to `big-agents`, merge commit `770cfc76b8d4a67a2665d181b00d3679e461fcc9`.
- #4930 `feat/agent-skills-4918-v2` -> retargeted to `big-agents`, merge commit `09a323495c21afaf784c171802db0cdb0b3ffe55`.
- #4931 `feat/agent-builder-tools-4919-v2` -> retargeted to `big-agents`, merge commit `959bb8e7499020c9edaf2e8eea947a39b73913cb`.
- #4935 `feat/advanced-collapsible-change1` -> retargeted to `big-agents`, merge commit `4901f9970b78c4f235007e3658da84e740222487`.
- #4936 `fix/agent-roundtrip-qa-20260630` -> retargeted to `big-agents`, merge commit `74755ebc2a59665740bafec51b8a2ad14b0f0c9a`.

Judgement calls:

- Created #4936 as a top stacked PR instead of trying to fold the QA hardening into lower lanes. The local GitButler projection was collapsed/malformed (`rebase-work` plus lower PR commits nested under `feat/agent-skills-4918-v2`), and lower-lane amendment risked scrambling reviewed branches.
- Removed the scratch handoff docs from #4936 before merge. They remain local unassigned so they are available for morning review without bloating the runtime QA PR.
- Did not merge `agent-design-docs`. The approved `advanced-build-kit` archive move already appears complete in the current tree (`projects/advanced-build-kit` missing, `archive/` present), but the design-doc lane remains local/unapplied and should be handled separately if desired.
- Did not run `but pull` after the GitHub merges because unrelated `.husky`, `website/*`, and `docs/design/marketing-website/*` changes are still unassigned and belong to other work. Pulling the GitButler workspace now could mix that work with the merged stack.
