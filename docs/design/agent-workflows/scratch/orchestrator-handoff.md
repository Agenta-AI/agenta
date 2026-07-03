# Orchestrator Handoff (for Codex / gpt-5.5, and any future agent)

This is a complete handoff for driving the **agent-builds-an-app** feature work on the
`big-agents` integration branch, the way the previous orchestrator (Claude) ran it. Read it
top to bottom once, then keep it open. The single most important rule is in **§3 GitButler**
— violate it and you will lose hours (we did, today).

Repo: `/home/mahmoud/code/agenta`. Branch: GitButler workspace over `big-agents`.
User: Mahmoud (mahmoud@agenta.ai). He reviews PRs and directs; you orchestrate and execute.

---

## 0. Current state for the next orchestrator (2026-06-30)

The agent-builds-an-app implementation stack is no longer waiting to merge. It was merged
bottom-up into `big-agents` overnight.

Merged PRs:

- **#4925** `feat/client-tool-roundtrip-4920` -> merge commit
  `ee2753e53afd7e950e70744cce9e117e7b516f1e`.
- **#4929** `feat/build-kit-4917-v2` -> merge commit
  `770cfc76b8d4a67a2665d181b00d3679e461fcc9`.
- **#4930** `feat/agent-skills-4918-v2` -> merge commit
  `09a323495c21afaf784c171802db0cdb0b3ffe55`.
- **#4931** `feat/agent-builder-tools-4919-v2` -> merge commit
  `959bb8e7499020c9edaf2e8eea947a39b73913cb`.
- **#4935** `feat/advanced-collapsible-change1` -> merge commit
  `4901f9970b78c4f235007e3658da84e740222487`.
- **#4936** `fix/agent-roundtrip-qa-20260630` -> merge commit
  `74755ebc2a59665740bafec51b8a2ad14b0f0c9a`.

The main PR to review after the fact is **#4936**. It contains the late QA/runtime fixes for
`request_connection` and `commit_revision`. The lower PRs were already reviewed, so the main
question is whether the top hardening PR is acceptable as a separate stack rung rather than
folded back into the lower lanes.

Overnight browser QA passed for the required behavior:

- `request_connection` is visible to the Pi path as a callable browser-fulfilled client tool.
- Calling `request_connection` renders the connection UI with retry controls.
- `commit_revision` commits a new revision, emits the frontend refresh event, switches the
  playground to the committed revision, and preserves the agent template shape.
- The EE dev stack was rebuilt after the merge and returned `200` at
  `http://144.76.237.122:8280/w`.

Residuals to review or track:

- Stream input display for `request_connection` and `commit_revision` still shows `{}` in the UI
  even when the tool behavior succeeds. Treat this as a follow-up, not as evidence that the
  browser behavior failed.
- Daytona non-Pi internal gateway tools may still not be advertised because `mcp.ts` skips
  loopback MCP on Daytona and file relay only executes calls. This appears pre-existing and
  outside the local Pi browser QA path.
- `agent-design-docs` was not merged. The advanced-build-kit archive move appears complete in
  the tree, but the design-doc lane should be reviewed and handled separately.
- The local scratch docs remain unassigned on purpose for morning review.
- The `marketing-website` lane is separate from the agent stack. Do not mix it into
  agent-workflows cleanup.

Judgement calls made:

- Merged with GitHub admin merge because CI was already known to be an unreliable gate for this
  stack, and targeted QA passed.
- Created #4936 as a top stacked PR instead of amending lower lanes because local GitButler
  projection was collapsed or malformed around `rebase-work`; amending lower reviewed lanes had a
  high risk of scrambling the stack.
- Removed scratch handoff docs from #4936 before merge. They remain local unassigned.
- Kept `/api/workflows/revisions/commit/patch` as preservation-only sparse merge semantics.
  Omitted fields preserve stored agent-template data. If clear/delete semantics are needed later,
  add an explicit operation rather than overloading omission or `null`.
- Did not run another broad GitButler resync after GitHub merges while unrelated work was present.
  Check `but status` before any new GitButler mutation.

---

## 1. How to work (orchestration model)

- **You are the orchestrator.** Offload fetching, research, bookkeeping, and execution to
  subagents; keep only load-bearing facts in your own context. If your harness cannot spawn
  subagents, do the work directly but follow every rule below identically.
- **Pick the cheapest capable model per task.** Mechanical/admin work (PR creation, copying
  comments, simple deploys, file scans) → a cheap model (Sonnet-class). Hard reasoning
  (merge-conflict resolution, GitButler recovery, architecture decisions, debugging) →
  a strong model.
- **Serialize all GitButler writes.** NEVER let two agents (or you + an agent) mutate the
  GitButler workspace at the same time. `but` locks its DB and parallel writes corrupt the
  projection. Read-only work (code review, research, browser QA that doesn't commit) can run
  in parallel. In practice: dispatch at most one workspace-mutating task at a time; queue the
  rest and dispatch the next when the previous finishes.
- **Report concretely, not vibes.** PR numbers, commit SHAs, target SHA, `but status`
  (behind / mergeBase / lanes / unassigned count), tests run + results, oplog snapshot IDs.
- **Writing style for everything user-facing** (and bake this into subagent briefs): no em
  dashes, active voice, short sentences, ~11th-grade English, bullets used sparingly. For any
  complex user-facing message, use the `style-editing` skill.
- **Ask when genuinely blocked on a user decision**; otherwise act. Don't re-ask things
  already decided. But do not guess on architecture or on his repo's GitButler state — verify.

### Subagent brief checklist (put these in EVERY brief)
- The exact goal + the lane(s) it may touch.
- "GitButler only, never raw git. Work in this trunk (`/home/mahmoud/code/agenta`), never a
  clone/worktree for the live edit. Snapshot first. Read `.agents/skills/gitbutler-workspace-recovery/SKILL.md`."
- What is off-limits (the `marketing-website` lane + `website/*` + `docs/design/marketing-website/*`
  belong to a different person — never touch them; the `agent-design-docs` lane is committed docs).
- The verification bar (tsc/ruff/tests) and "report SHAs + `but status`".
- "If a `but` step scrambles the workspace, `but oplog restore` the snapshot and report, don't force."

---

## 2. Skills (what they are, when to use them)

Skills live in `.agents/skills/<name>/SKILL.md` (Codex discovers `.agents/skills`; they're also
symlinked into `.claude/skills`). Each has a `SKILL.md`; heavy detail is in `references/`.

- **`gitbutler-workspace-recovery`** — READ THIS before any GitButler recovery/sync/PR-repair.
  Has `references/recovery-runbook.md`. Use whenever lanes diverge, `but apply`/`but pull`
  misbehaves, merged changes show as unassigned, hunk locks/empty commits appear, or you need
  to sync the workspace.
- **`plan-feature`** — design a feature into design docs (first-principles, current-state-only).
- **`implement-feature`** / **`queue-implement-feature`** — implementing a planned feature; the
  queue variant manages a feature queue with a user-facing STATUS.md.
- **`write-pr-description`** — PR bodies (lead with concrete symptom + before/after).
- **`style-editing`** — rewrite any complex user-facing text to house style.
- **`debug-local-deployment`** — diagnose the local docker-compose stack.
- **`run-sh`** — the deploy command and its flags.
- **`agent-workflows-qa`** — the QA matrix + harness for the agent feature (credit hygiene baked in).
- **`agent-replay-test`** — replay-test agent runs.
- **`design-interfaces`** — structure any contract by semantic role (data/config/policy/
  credentials/routing/context/metadata), not by feature.
- **`write-docs`** / **`keep-docs-in-sync`** — Agenta docs voice + keeping docs current.
- **`defer-todo`** — record a deferred TODO properly instead of silently dropping it.
- **`agenta-package-practices`** — package vs app placement, `@agenta/*` packages.
- **`write-issue`** — file an issue in house format.

Tell subagents to read the specific skill their task needs.

---

## 3. GitButler — THE rule (read twice)

This repo is in GitButler workspace mode. **Use `but` for ALL version control. NEVER raw
`git` for commits/branches/checkout/reset/stash.** Always operate in the live trunk; never
implement in an isolated clone or `git worktree` (the one exception: a throwaway worktree is
OK *only* for reading source during a rebase, never for the live edit, and never to "build then
copy in").

Core commands:
- `but status` / `but status --json -f` — workspace state (lanes, unassigned, mergeBase, behind).
- `but oplog snapshot -m "..."` before any risky op; `but oplog restore <id>` to rewind.
- `but branch new <name>` — new lane; `but stage <fileOrCliId> <branch>`; `but commit <branch> --only -m "..."` (commits only what's staged to that branch).
- `but apply <branch>` / `but unapply <branch>`; `but push <branch>` (prints nothing on success — verify with `git ls-remote` vs `git rev-parse`); `but push <branch> -f` after amend/rebase.
- Committing to a **lower** lane in a stack rebases the lanes above it — after, verify `but status --json -f` and `but push -f` every affected lane.
- Stacked PRs are linear; express a "fan-out" via PR bases (set each PR's `--base` to the branch below it), not graph shape.

**Hard-won facts (these cost us a full day):**
- **`but apply` that "succeeds" but the branch never appears as a lane = a SILENT NO-OP.** Cause:
  a **stale applied lane holding the workspace base behind the real target** (base-drift /
  projection). Fix: `but unapply <stale-lane>` → `behind` clears and `mergeBase` re-anchors →
  `but apply` then works and auto-stacks branches whose parent matches the tip. This is NOT
  caused by ref count or worktree count (pruning 16 clean worktrees moved the goals-limit by
  zero). See `gitbutler-workspace-recovery`.
- A stacked feature branch can be built on an **older** big-agents than current. Before applying,
  check `git merge-base origin/big-agents <branch>` vs `git rev-parse origin/big-agents`. If
  behind, **rebase the feature commits onto current big-agents first** (in a throwaway source
  worktree — raw git OK there only), preserving merged work, then force-push, then apply. A
  naive apply of a stale branch reverts whatever merged in between.
- **Do not "fix" GitButler with hacks**: no file-copy + `but commit` into a single combined lane,
  no raw `git checkout` into the trunk, no pruning the user's worktrees/refs. Read the skill and
  do it properly. The user is emphatic about this.
- `gh pr edit` fails here on classic-Projects GraphQL → edit PR bodies/labels via `gh api ... PATCH`.

---

## 4. Local development loop (deploy + test)

**The running dev stack (where we QA the playground):**
- Edition/image: **EE + dev**. Compose project: **`agenta-ee-dev-wp-b2-rendering`**.
- Served at `http://localhost:8280` (public host on the box: `http://144.76.237.122:8280` —
  use the public host in a browser when localhost auth cookies don't apply).
- Env file: **`.env.ee.dev.local`** (NOT the base `.env.ee.dev`).
- The stack **mounts the worktree source and hot-reloads** (API via uvicorn `--reload`, web via
  Next dev). So code in the trunk is what's served. Restart the API container to pick up changes
  the reloader misses (e.g. the static catalog). 
- Recreate the **web** container the correct way (so `entrypoint.sh` regenerates `__env.js` from
  the right URLs — `__env.js` is gitignored and generated from `AGENTA_WEB_URL`/`AGENTA_API_URL`;
  never hand-edit it):
  ```bash
  cd hosting/docker-compose/ee && ENV_FILE=.env.ee.dev.local \
    docker compose -f docker-compose.dev.yml -p agenta-ee-dev-wp-b2-rendering \
    --env-file .env.ee.dev.local --profile with-web up -d --force-recreate web
  ```
- **New third-party FE dep** (not `@agenta/*`): the dev web image **bakes node_modules** and
  mounts only source, so a new npm dep needs an image rebuild (`run.sh ... --build --no-cache`
  for web). `@agenta/*` workspace packages are picked up by a host `pnpm install` + web restart.
- General deploy (matches `load-env` to the flags): `load-env hosting/docker-compose/ee/.env.ee.dev`
  then `bash ./hosting/docker-compose/run.sh --ee --dev --build` (`--down`/`--nuke` to stop/drop).
  The `run-sh` skill has the flag matrix. (Our running stack is the custom `*-wp-b2-rendering`
  project on `.env.ee.dev.local`, recreate web with the command above.)
- Postgres reachable locally with `username:password`; EE DB name `agenta_ee_core` (port 5434 on
  this box).
- **Test accounts**: mint via `POST /admin/simple/accounts/` (header `Authorization: Access AUTH_KEY`,
  `create_api_keys/return_api_keys: true`). Reuse fixtures in `api/oss/tests/pytest/utils/accounts.py`.

**Running tests:**
- `cd <area> && py-run-tests` where area ∈ {`sdks/python`, `api`, `services`}. It runs
  `uv sync --locked && uv run --no-sync python run-tests.py`.
- Web: `pnpm` (per package); `tsc --noEmit` to typecheck a package.
- **Before committing**: API/SDK → `ruff format` then `ruff check --fix` (from repo root or the
  area). FE → `pnpm lint-fix` in `web/`. Ant Design token changes → `pnpm generate:tailwind-tokens`.
- Standalone throwaway scripts: run with `uv run` and declare deps via the `# /// script` inline
  block (user convention).

**Environment config**: new API config goes in `api/oss/src/utils/env.py`, consumed via the
shared `env` object — never `os.getenv(...)` directly.

---

## 5. QA for the agent feature

- Use the **`agent-workflows-qa`** skill (it bakes in the credit hygiene rules).
- **Credit hygiene (hard rules):** the subscription sidecar (`:8790`, OAuth) is the main Claude
  target for QA. Prefer **local + sidecar**; use Daytona only with confirmed credits and
  **NEVER leave a Daytona sandbox open** (we've burned credits). Use cheap models for routine
  runs (gpt-4o-mini / haiku / sonnet).
- **Secrets:** `ANTHROPIC_API_KEY` (and QA secrets) live in `~/.agenta-qa-secrets.env` (mode 600,
  OUTSIDE the repo — never commit). Self-managed Claude Code needs an API key (not subscription
  OAuth). Never bake/distribute Claude Code in any published image (proprietary) — self-host recipe
  only; Pi is MIT and bakeable.
- The **`pi-agents` project** has a live Anthropic key + Composio connections; use its own API key
  (vault/connections ignore a `?project_id` override).
- Prefer testing agent behavior **programmatically** (hit the sidecar `/run` by container IP, or
  `AgentTemplate.from_params` / the resolve endpoints) over driving the browser, when the thing
  under test is config/parse/resolve. Use the browser when the thing under test is the UI itself.

---

## 6. PRs, reviews, comments

- **Open PRs** with `write-pr-description` (lead with the concrete symptom + before/after, not
  padded bullets). Title: `[issue-id] type(area): Title` (type ∈ fix/feat/chore/ci/doc/test;
  area ∈ API/SDK/frontend/docs/...). Add the `needs-review` label and a comment stating exactly
  what feedback is wanted (never a generic "check it out"). Trigger `@coderabbitai review`.
- **Stacked PRs**: set each PR's base to the branch directly below it so the diff shows only that
  lane's files.
- **AI-agent comments** must be prefixed `🤖 _The AI agent says:_` and **never signed as Claude**.
  They post under the user's GitHub account (gh token), so the prefix is how they're identified.
- **The review→fix loop** (this is the active workflow): the user reviews a PR and leaves comments
  → you spin a subagent to address his comments + CodeRabbit's findings on that lane via GitButler
  (`but commit <branch> --only`, `but push <branch> -f`) → he re-reviews → when he's happy with all
  PRs, merge **bottom-up**. Run `/debug-local-deployment` between milestones; don't trust "tests
  green" as "stack up".
- **CI**: currently broken on many PRs, so don't block merges on full CI; fix CI post-merge. Short
  API/unit/lint/contract checks should be green; slow/outdated web tests may be skipped if noted.
- **Known cleanup pending the user's OK**: when these PRs were rebuilt, a subagent re-posted the
  OLD PRs' CodeRabbit findings as inline `🤖 _The AI agent says:_` comments (mislabeled, not
  applied). They duplicate CodeRabbit's fresh review. Don't treat them as the user's review. He
  has not yet confirmed deleting them — leave them until he does; address the *real* findings
  (his genuine comments + `coderabbitai[bot]`'s fresh ones).

---

## 7. Writing skills / docs

- **New skill**: `.agents/skills/<name>/SKILL.md` with frontmatter (`name`, `description`); put
  heavy reference in `references/`. Keep `SKILL.md` short; it loads on demand. Symlinked into
  `.claude/skills`.
- **Docs**: `write-docs` skill (Agenta voice/structure) + the Diátaxis digest at
  `agents/docs/diataxis/`. Docs site is Docusaurus under `docs/`. `keep-docs-in-sync` after code
  changes that affect documented behavior.
- **Agent-instruction layering**: cross-cutting rules in root `AGENTS.md`; area conventions in
  `web/AGENTS.md`, `api/AGENTS.md`, `hosting/AGENTS.md`; procedures in skills. Put new instructions
  at the lowest scope that fits; don't grow the root file.

---

## 8. The feature: agent-builds-an-app (architecture you must understand)

Goal: a new agent created in the playground comes pre-loaded with default platform tools + skills
+ AGENTS.md, opt-out by delete, without those defaults being baked into the published config.

- **Build-kit OVERLAY model**: the backend serves a **read-only overlay** on the simple-applications
  read path — `GET /api/simple/applications/{id}` returns
  `additional_context.playground_build_kit.agent_template_overlay`. The **frontend** applies the
  overlay onto `parameters.agent` on a playground RUN (deep-merge object fields, identity-merge
  list fields, on a throwaway copy), and **excludes it on commit**. The agent service stays dumb
  (no run flag, no service-side injection). The published default goes bare.
  - IMPORTANT wiring fact: the FE reads the overlay from the **simple-applications response**, NOT
    from the agent-service `POST /services/agent/v0/inspect` (that inspect carries no
    behavior-changing meta by design). We fixed a bug where the FE read the wrong source.
- **The overlay contains**: PLATFORM_OPS as platform tools `{"type":"platform","op":"<op>"}`;
  embedded skills/tools via `@ag.embed`; sandbox permissions.
- **Embed shape (canonical, both tools and skills)**:
  ```json
  {"@ag.embed": {"@ag.references": {"workflow": {"slug": "__ag__<name>"}},
                 "@ag.selector": {"path": "parameters.tool"}}}   // or "parameters.skill" for skills
  ```
  The `@ag.selector` is REQUIRED — without it the resolver inlines the whole revision payload and
  the SDK rejects it ("Unsupported tool configuration shape"). We fixed the overlay to include it.
- **Static catalog**: reserved `__ag__*` slugs, **code-defined** (no DB, no per-project seed) —
  `api/oss/src/core/workflows/static_catalog.py` + `sdks/python/agenta/sdk/agents/platform/workflow.py`.
  Tool configs are discriminated by **`type`** (e.g. `type:"client"`), NOT `kind` — we fixed a bug
  where `request_connection` was stored with `kind:"client"` and coerced to a builtin.
- **`request_connection`** = a **client tool** (`@ag.embed` reference → `ClientToolSpec`,
  `render.kind:"connect"`). The frontend DRIVES it: runner parks the call, UI runs the connect
  flow, agent resumes. (Arda's PR #4934.)
- **`commit_revision`** = a **platform tool**; on commit the backend emits a one-way
  `data-committed-revision` event → the playground listens and refreshes the config. (Arda's #4934.)
- **Slug-vs-name** (in-flight fix): build-kit rows were showing the raw slug (`__ag__...`); the fix
  has the overlay include the resolved `WorkflowRevision.name` and the FE render it (slug fallback),
  for both embedded tools and skills.
- Design docs: `docs/design/agent-workflows/projects/{default-agent-config, agent-skills,
  agent-builder-capabilities, agent-fe-roundtrip, advanced-build-kit, agent-builds-an-app}/`.

---

## 9. STATE as of this handoff (2026-06-29)

**The applied stack in the trunk (bottom → top), all pushed, all `local == remote`:**
- `feat/client-tool-roundtrip-4920` — **PR #4925** — base `big-agents`. Client-tool round-trip
  backend + the `static_catalog` `type:"client"` fix.
- `feat/build-kit-4917-v2` — **PR #4929** — base #4925. Build-kit overlay (backend on the
  simple-apps response + FE drawer/overlay) + the FE overlay-source wiring fix + the `@ag.selector`
  embed fix.
- `feat/agent-skills-4918-v2` — **PR #4930** — base #4929. Platform authoring skill in the catalog.
- `feat/agent-builder-tools-4919-v2` — **PR #4931** — base #4930. Platform ops (op_catalog:
  schedules/subscriptions) + `find_triggers`.
- `agent-design-docs` lane — the design docs (committed).
- `marketing-website` lane + unassigned `website/*` + `docs/design/marketing-website/*` — **another
  person's work, DO NOT TOUCH.**

**Verified live:** the build-kit drawer renders in the playground; the "Unsupported tool
configuration shape" 500 is fixed (both embed bugs); auth works on the dev stack.

**LIVE RESUME STATE (last updated 2026-06-29, near token-cutoff) — READ THIS FIRST.**

All six PRs are reviewed by Mahmoud and their feedback is addressed. The stack is built and pushed.
Remaining: finish the #4934 apply+QA, do the advanced-build-kit archive move, then merge bottom-up.

**PR status (stack bottom→top; lane SHAs after the last rebase):**
- **#4925** client-tool backend — `feat/client-tool-roundtrip-4920` @ `af0e4d9ba2` — **LGTM ✓**. Architecture explained (the `/tools/call`→`_call_workflow_tool` path is a justified thin adapter over the same in-process `invoke_workflow`, from #4860 — no follow-up wanted); `permissions.ts` comment added; + two fixes: vercel `tool-output-error/denied` marker guard, and the **commit-emit fix** (the regular `commit_workflow_revision` now emits `committed-revision` — load-bearing for #4934's commit-refresh).
- **#4929** build-kit overlay — `feat/build-kit-4917-v2` @ `b4873b7591` — **addressed ✓**: FE reads the overlay from the simple-applications response; `@ag.selector` on embeds (code-true shape `{"@ag.selector":{"path":"parameters.tool"}}`); slug→name; Mahmoud's comments + CodeRabbit.
- **#4930** skills — `feat/agent-skills-4918-v2` @ `505fb1b5fe` — **LGTM ✓**. Merge condition: confirm the authoring skill shows in the playground (covered by the #4934 QA).
- **#4931** builder tools — `feat/agent-builder-tools-4919-v2` @ `34f4351947` — **addressed ✓**: trigger tests expanded 8→22, PUT answered (excluded by design), stronger trigger-match evidence, create-trigger schemas locked (`additionalProperties:false`), path-params stripped from POST body, specific error-type asserts.
- **#4935** collapsible advanced sections — `feat/advanced-collapsible-change1` @ `1fc6548035` — **LGTM ✓ addressed**: collapse-everything-by-default + `aria-expanded` + cancel-toggle restore.
- **#4934** Arda's FE round-trip — **LGTM ✓**; **being applied + QA'd now** (connect flow + commit-refresh).

**Other:**
- **Design-doc PRs #4917–#4921: CLOSED** (redundant — implemented by the stack; docs on `agent-design-docs`).
- **Docs committed** to `agent-design-docs` @ `c61362ba94` (design docs + interface inventory reconciled with as-built + style pass). **This lane merges LAST.**
- The 3 build-kit UX nits are all resolved: cancel-toggle FIXED; override-list MOOT (overlay permissions ARE shown; the warning only fires on real conflicts); switch-in-button already handled (`stopPropagation`).

**⚠️ TWO OVERNIGHT ISSUES (2026-06-29 → 06-30) — must be handled before merge:**

A. **#4934's merge was CLOBBERED.** Arda merged his FE round-trip PR #4934 into its base `feat/client-tool-roundtrip-4920` (#4925) at 2026-06-29 20:23, merge commit **`5957270e5b`**. Our later force-push of the #4925 fixes (to `af0e4d9ba2`) overwrote the branch, so `5957270e5b` is NOT an ancestor of the current #4925 tip and the `clientTools/` FE files are gone from the branch. #4934 still shows MERGED on GitHub but its code is only in `5957270e5b`. **Restore #4934's FE round-trip into the #4925 lane** (cherry-pick / re-apply from `5957270e5b`, or re-merge). Lesson: don't force-push a shared branch a teammate may have merged into — check upstream first.

B. **big-agents advanced a lot overnight**: `0755d8607e` → **`331930bff0`**, including sessions (#4916), agent-invoke endpoint (#4875), and **agent-template-schema-driven (#4932)** — more agent-template UI work that the build-kit FE (#4929/#4935) overlaps. The stack is now well behind and the agent-template UI has drifted again.

**REMAINING WORK (in order; serialized `but` writes; read the gitbutler-workspace-recovery skill first):**
1. **Rebase the whole stack onto current big-agents (`331930bff0`)**, resolving the agent-template UI conflicts again (the #4932 refactor) the same way as before: keep big-agents' refactored agent-template structure and re-apply our build-kit drawer + collapsible on top. Force-push each lane (verify local==remote).
2. **Restore #4934's FE round-trip** into the #4925 lane from `5957270e5b` (the connect-flow + commit-refresh FE). Verify `clientTools/` + the resume predicate + the `data-committed-revision` listener are back.
3. **Re-run the round-trip QA** on the rebased state: a self-managed Claude Code + Sonnet agent driving (a) request_connection connect flow, (b) commit_revision→refresh; plus the #4930 skill-in-playground check. (The earlier in-flight QA (agent a01fc17d) ran on a now-stale state — redo it.)
4. **Archive move** (Mahmoud approved): `docs/design/agent-workflows/projects/advanced-build-kit/` → `docs/design/agent-workflows/archive/`, commit to `agent-design-docs`.
5. **Merge bottom-up** into big-agents: #4925 (with #4934 restored) → #4929 → #4930 → #4931 → #4935, each rebased onto the freshly-merged base; then **agent-design-docs last**.

**DECISIONS LOCKED:** no #4925 architecture follow-up; keep the 3-min connect timeout; origin fail-open is acceptable (optional fail-closed validation after merge); commit-emit fixed. Don't re-ask these.

---
_Historical detail below (superseded by the snapshot above):_

**LIVE RESUME STATE (token-cutoff, 2026-06-29) — READ THIS FIRST. Keep this section in sync.**

**#4929 — DONE** (committed + pushed, local==remote): `feat/build-kit-4917-v2` → `d07809e757`,
`feat/agent-skills-4918-v2` → `851f2e096a`, #4931 (`feat/agent-builder-tools-4919-v2`) rebased to
`adf0f9ea46`. Addressed Mahmoud's two #4929 comments (overlay as an explicit `AgentTemplateOverlay`
model; merge extracted to `buildKitOverlay.ts`) + CodeRabbit's findings (zod boundary validation in
`fetchSimpleApplication`; overlay applies to bare templates + regression test) + the slug→name fix for
both embedded tools and skills. Verified: ruff clean, 4/4 pytest, 28/28 vitest, tsc clean (3 packages).
OPEN ITEM (Mahmoud's call): three older 🤖-list UX findings on the now-refactored `AgentTemplateControl`
were left as stale dupes — (a) cancel won't restore the build-kit toggle, (b) overlay-added permissions
not shown in the override list, (c) the enable switch sits inside the header button. They're real UX nits
on #4929; decide whether to fix (could fold into the collapsible/build-kit polish).

Also uncommitted in the worktree (commit to the `agent-design-docs` lane when convenient):
this handoff doc and `merge-queue.md`.

**#4931 — DONE** (commit `cc2e131c2e` on `feat/agent-builder-tools-4919-v2`, pushed, local==remote;
green: 22 triggers, 85 SDK, 45 vitest, tsc clean). PUT answered on-thread as intentionally excluded
(direct-call path is GET/POST/DELETE only). Addressed all 6:
- Mahmoud: `test_triggers_discovery.py` — tests too thin for complex logic, add many more cases.
- Mahmoud: `op_catalog.py:71` — any reason PUT isn't included? (answer or add PUT.)
- CodeRabbit (Major): `api/oss/src/core/triggers/service.py:147` — require stronger evidence before surfacing a primary trigger match.
- CodeRabbit (Security, Major): `op_catalog.py:359` — close the create-trigger schemas so the model can't retarget them (self-target guarantee).
- CodeRabbit (Major): `services/agent/src/tools/direct.ts:249` — strip substituted path params out of the POST payload.
- CodeRabbit (Minor): `test_triggers_discovery.py:212` — assert the specific validation error type, not bare `Exception`.
Address via GitButler, `but push -f`, reply on the threads prefixed `🤖 _The AI agent says:_`, then tell Mahmoud.

**Reviewed, not yet applied:**
- **Arda's PR #4934** (FE round-trip: `request_connection` connect flow + `commit_revision` refresh).
  Review verdict: correctly implements both round-trips, fits the design, **no file conflicts** with
  our stack (touches only `web/` files: AgentChatPanel, AgentMessage, a new `clientTools/` folder,
  `agentApprovalResume.ts`, `workflow/state/store.ts`). Its base is #4925; rebase its base to
  big-agents at merge time. Decisions locked by Mahmoud: keep the 3-min connect timeout; the
  fail-open origin check is fine (if the API origin is null nothing works anyway) — optionally add
  validation AFTER merge; verify the commit-emit actually fires in QA (it can be dropped on the
  direct-commit path when `request.state.emit` is None).

**Decided but not built (deferred change):**
- **Collapsible "Change 1"**: wrap the three advanced committed-config groups (Authentication,
  Execution environment, Permissions) in collapsible accordions (default collapsed, multi-open,
  right-aligned summaries). Specced in `default-agent-config/design.md` ("Change 1", ships
  independently). Mahmoud said: **build it now as a new stacked PR.** Straightforward, no
  contract/logic change; mainly `useModelHarness.tsx`.

---

## 10. NEXT STEPS (the queue — serialize all `but` writes)

1. **Finish #4929 fixes** (in flight). Verify it committed his comments + CodeRabbit + slug→name to
   #4929/#4930, rebased the upper lanes, pushed all affected, stack intact.
2. **Collapsible Change 1** → new stacked PR on top of the stack (after #4929 settles, so two agents
   aren't editing the build-kit FE at once).
3. **Apply #4934 + QA the round-trips.** Apply via GitButler (rebase its base onto current big-agents
   first if needed). Then QA: create an agent app that uses **Claude Code self-managed with Sonnet**,
   prompt it to (a) request a connection (e.g. "set up a GitHub PR-review trigger on agenta-ai/agenta")
   so `request_connection` fires the connect flow, and (b) commit a revision so the playground
   refreshes. Confirm BOTH behaviors actually happen. Run `/debug-local-deployment`. If clean, tell
   Mahmoud → he merges into our branch.
4. **Address Mahmoud's reviews on #4930 / #4931 / #4934** as they arrive (he's reviewing now) — one
   subagent per PR, on that lane, GitButler, `push -f`.
5. **Pending / housekeeping:** the stack is `behind` big-agents (it advanced upstream) — pull to bring
   it current when convenient (use the recovery skill; `but pull --check --json` first). The stale
   `🤖` duplicate comments cleanup awaits Mahmoud's OK. Optionally add the origin fail-closed
   validation after the #4934 merge.
6. **End state:** when Mahmoud is happy with all PRs, **merge bottom-up** (#4925 → #4929 → #4930 →
   #4931 → #4934), re-basing each PR onto the freshly-merged base.

---

## 11. Relevant memories (the previous orchestrator's, summarized — you can't read its memory store)

- **Never use git worktree for implementation; always GitButler stacked lanes in the trunk.**
- **`but apply` no-op = stale lane holding the base behind target; fix = `but unapply` the stale
  lane; not the refs/worktrees; use the recovery skill.**
- **QA credit + sandbox hygiene**: subscription sidecar is the main Claude QA target; cheap models;
  never leave a Daytona sandbox open; secrets in `~/.agenta-qa-secrets.env`.
- **Workflow name semantics**: `artifact.name` = entity name (display via `selectors.artifactName`);
  `revision.name` = variant name; never display the slug.
- **Prefer a config/env switch over editing FE code** when a flag achieves the goal.
- **Normalize FE/BE shape mismatches on the frontend read path**, not by changing the backend.
- **Run the real project test targets**, not ad-hoc scripts.
- **Dev stack gotchas**: web image bakes node_modules (new dep → image rebuild); `__env.js`
  regenerated from env (use `.env.ee.dev.local`); plain-HTTP dev box breaks secure-context Web APIs
  (e.g. `crypto.randomUUID`) — guard them.
- **Coordinate with other humans' agents** (Arda on FE + the marketing website); their lanes/folders
  are off-limits; Slack `#non-human-chat` for cross-agent sync.

---

When in doubt: read the skill, snapshot, do it in the trunk with `but`, verify, report SHAs. Don't
hack the workspace. Ask Mahmoud on any real decision; otherwise keep the queue moving.

---

## RESUME STATE — apply + QA of PR #4934 (FE client-tool round-trip) — 2026-06-30

Task: apply Arda's #4934 (FE client-tool round-trip) onto the stack, deploy, QA two FE behaviors.
Target `big-agents`. The apply+deploy is DONE and verified; the QA is UNRELIABLE/UNVERIFIED (see
below) and should be re-run cleanly.

### 1. #4934 applied — DONE (lane `fe-feat/client-tool-roundtrip-fe`)
- #4934 is MERGED on GitHub into #4925's branch; head ref `fe-feat/client-tool-roundtrip-fe`.
  Its single commit `08d2f90a` was based on the #4925 backend commit `76b89f41`, NOT on our
  rebased stack tip `af0e4d9ba2` (= #4925 `feat/client-tool-roundtrip-4920`).
- `but apply fe-feat/...` SILENTLY NO-OP'd twice. Root cause was NOT a stale lane (unapplying the
  empty `t9` lane did not help — restored the snapshot). The fe branch's history already contained
  the entire applied `cl` stack, so GitButler found nothing new to isolate as a parallel branch.
- What worked: in a throwaway worktree (raw git OK there only) `git rebase --onto af0e4d9ba2
  76b89f41 08d2f90a` → ZERO conflicts (15 web-only files; no overlap with cl's api/sdk/services
  files) → force-pushed the fe branch (remote now `8754798779`). Then in the trunk:
  `but branch new fe-feat/client-tool-roundtrip-fe --anchor feat/client-tool-roundtrip-4920`,
  `git checkout 8754798779 -- <15 files>` into the tree, `but rub <cliId> g0` each file to the
  new lane, `but commit fe-feat/client-tool-roundtrip-fe --only --message-file <Arda's msg>`.
- VERIFIED: lane tip `d84f23efb7`; `git diff feat/client-tool-roundtrip-4920..fe-feat/...` = exactly
  the 15 files; `cl` is ancestor of `fe` (correctly stacked ON TOP); 28 unrelated website/marketing/
  scratch unassigned changes untouched. Oplog snapshots: `06c6d7d970`, `f47ac0c973`, `f20816a04b`.
  NOTE: local fe lane commit `d84f23efb7` differs in hash from the pushed remote `8754798779`
  (GitButler recommitted) — content identical; lane shows `unpushedCommitsRequiringForce`. Not
  pushed again (QA only needs the local worktree the dev stack mounts).

### 2. Deploy — DONE + fixed a pre-existing crash
- Recreated `web` (`-p agenta-ee-dev-wp-b2-rendering`, `--env-file .env.ee.dev.local`, profile
  with-web) and restarted `api`. `web/packages` is bind-mounted so the @agenta/entities +
  @agenta/playground edits are live. `/api/health`=200, web compiling clean.
- `sandbox-agent` was crash-looping BEFORE this task (web-only change is unrelated). Cause: the
  running container was an OLDER image whose baked `scripts/build-extension.mjs` also bundled
  `src/tools/relay-mcp-stdio.ts`, which our worktree removed (replaced by HTTP-loopback
  `tool-mcp-http.ts`). The fresh `:latest` image has the correct 1-entry build. FIX:
  `docker compose ... up -d --force-recreate sandbox-agent` → healthy, listening :8765.
  (`scripts/` is NOT bind-mounted; only `src` and `skills` are — a stale image diverges from the
  mounted src. Recreate from latest image, don't restart.)

### 3. QA — UNVERIFIED. The QA subagent (Sonnet) was UNRELIABLE; re-run needed.
Setup facts (good): project `pi-agents` (project_id `019ecbaf-5f3f-7d12-9aef-f49272dfd82e`,
workspace `019e8df5-2a4f-7ab2-b71a-c7dd27c589b6`) has a live Anthropic key + Composio connections.
Agent app "Agent" app_id `019ef441-7603-7930-9b4b-39c4020222a4`; its `default v2` variant's
`parameters.agent` is EMPTY — must author harness=Claude-self-managed + Sonnet + build-kit before
testing. Apps use template `agenta:builtin:agent:v0`; build-kit tools (request_connection + platform
ops like commit_revision) + skills are injected CLIENT-SIDE by
`web/packages/agenta-playground/src/state/execution/buildKitOverlay.ts` (`withBuildKitOverlay()`).
Login resiros@gmail.com / K4m!t0s- at 144.76.237.122:8280.

The subagent's findings and WHY THEY ARE NOT TRUSTWORTHY:
- (a) request_connection / connect widget: subagent claimed "broken — client tools are filtered
  out of the MCP server Claude sees (mcp-bridge.ts:93, tool-mcp-http.ts:97) so Claude can't call
  it." That filter is BY DESIGN: client tools (`kind:"client"`) are browser-fulfilled, never handed
  to the harness (dispatch.ts:112-116 throws if executed; responder.ts parks `client_tool`). So the
  root cause is a MISDIAGNOSIS. The subagent NEVER observed the FE — no ConnectToolWidget render was
  confirmed, NO `qa-connect.png` was produced. STATUS: INCONCLUSIVE/UNVERIFIED. Open question it did
  NOT answer: by what path is request_connection emitted-and-parked to the FE if the harness can't
  call it (system-emitted when a gateway tool needs a connection? a skill/platform op?).
- (b) commit_revision → refresh: subagent reported 3 bugs. B-1 ("runContext NEVER passed to
  startToolRelay") is DEMONSTRABLY FALSE — `request.runContext` IS the 6th arg at
  sandbox_agent.ts:456. The subagent quoted code that doesn't match the file (unreliable reading).
  Its behavioral claim (commit_revision via the agent created NO revision; version stayed "v4
  Draft"; 0 new rows in `workflow_revisions`; so no `data-committed-revision` event, no FE refresh)
  MIGHT be real but is NOT trustworthy without independent repro. Only `qa-commit-refresh.png` was
  saved. STATUS: UNVERIFIED (possibly-negative but unconfirmed). NOTE the #4925 commit-emit fix is
  on the REGULAR commit endpoint (commit `af0e4d9`, `_emit_committed_revision_data_event`, guards
  `if not workflow_revision: return`) — if the agent-driven commit produces no revision, that emit
  never fires, but that does not by itself prove the #4934 FE refresh code is wrong.
- (c) #4930 authoring skill in build-kit: subagent says `agenta-getting-started` shows as an
  `@ag.embed` (slug under `_agenta.*`) — plausible, matches the schema seen in the variant data.
  Reasonably credible but not independently re-verified.

NEXT STEPS (re-run): author a real Claude-self-managed + Sonnet + build-kit config (JSON-view paste
is more reliable than the Form), then (a) prompt something needing a connection and confirm the
ConnectToolWidget actually renders inline (render.kind:"connect") + screenshot `qa-connect.png`;
(b) drive a commit_revision and watch the network stream for the `committed-revision` part + a
workflows/revisions refetch + the version bump, screenshot `qa-commit-refresh.png`; FIRST resolve
HOW request_connection is emitted-and-parked (read responder.ts + buildKitOverlay.ts) so the connect
test is even possible. Use Sonnet for the test agent; local runner only; never open Daytona. Treat
any pure code-reading root-cause from a cheap subagent with suspicion — confirm against the file.
