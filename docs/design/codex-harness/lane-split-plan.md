# Lane-split plan

> SUPERSEDED by decision D-009 (Mahmoud, 2026-07-25): the branch ships as a SINGLE PR with thorough
> inline review comments, NOT stacked lanes. Reasoning (in decisions.md): the split's only purpose is
> reviewability; the concern split needs hunk-level file splitting against already-made commits (the
> painful GitButler case), and the area split's lanes are not independently meaningful (the wire
> contract spans SDK and runner). This document is kept for history and for the file-to-area map,
> which is still useful when writing the single PR's description and review comments.

How to break the `worktree-codex-harness` branch into stacked GitButler lanes for review in the
main checkout. This is a plan only. The GitButler execution happens later, in the main checkout,
with Mahmoud's go-ahead. Nothing here pushes, merges, or runs `but`.

Branch base: `7b971d8c10` (main at the time the worktree was cut). Range under split:
`git diff 7b971d8c10..HEAD`, 80 files across 25 commits (Milestones 1 through 5 plus the
add-harness playbook commit `f5302ffe7a` the coordinator landed).

## The one fact that decides the split

Every changed file lives in exactly one top-level area. There is no file that lives in two areas.
Confirmed:

```
git diff --name-only 7b971d8c10..HEAD | sed -E \
  's#^(sdks/python)/.*#\1#; s#^(services/runner)/.*#\1#; s#^(web)/.*#\1#; s#^(docs)/.*#\1#; s#^(.agents/skills)/.*#\1#' \
  | sort | uniq -c
#  21 sdks/python      34 services/runner      1 web
#  20 docs             4 .agents/skills        1 .gitignore
```

So a split **by area** produces lanes whose file sets are disjoint by construction, with zero files
carried across two lanes. A split **by concern** (SDK / runner-core / approvals / subscription+Daytona
/ docs) reads better per PR but forces five core runner and SDK files to be split hunk-by-hunk across
lanes, which the repo's `AGENTS.md` documents as the error-prone case. Both options are below;
the area split is recommended.

## Recommended: area split (4 lanes, disjoint file sets, no split files)

Stacks are linear here; the fan-out is expressed through PR bases, not graph shape (`AGENTS.md`).
Build one linear stack in dependency order and set each PR's base to the branch directly below it.

| # | Lane | Files | PR base | Depends on |
|---|---|---|---|---|
| 1 | `codex-sdk` | `sdks/python/**` (21) | `main` | nothing |
| 2 | `codex-runner` | `services/runner/**` (34) | `codex-sdk` | the SDK golden wire fixture + harness values |
| 3 | `codex-web` | `web/**` (1) | `codex-runner` | SDK capabilities (harness list); disjoint from the runner |
| 4 | `codex-docs` | `docs/**`, `.agents/skills/**`, `.gitignore` (46) | `codex-web` | describes all of the above; no code dependency |

Dependency order rationale:

- **SDK first.** It owns the closed harness enum (`HarnessType.CODEX`), the adapters, the capabilities
  and model catalog, the wire mirror (`utils/wire.py`, `wire_models.py`), and the golden fixture
  `oss/tests/pytest/unit/agents/golden/run_request.codex.json`. Nothing it changes depends on the
  runner.
- **Runner second.** `services/runner/tests/unit/wire-contract.test.ts` asserts the SDK's golden
  fixture, and the runner reads the `codex` harness value the SDK defines, so the runner lane must sit
  on top of the SDK lane for a clean, self-consistent diff.
- **Web third.** One line in `HarnessSelectControl.tsx` surfaces the codex harness in the picker. It
  depends on the SDK capabilities document, not on the runner, and its file set (`web/**`) is disjoint
  from the runner, so it may sit anywhere above the SDK lane. It is placed above the runner only to
  keep the stack linear.
- **Docs last.** The design workspace, the user-facing self-host page, the interface inventory
  updates, and the two skills (`add-harness`, the `agent-release-gate` codex cell) plus the
  `.gitignore` allowlist line (`!.agents/skills/add-harness/`) that tracks the playbook. No code
  depends on these, so they ride on top.

Per-lane PR bases for `gh pr create` (each PR shows only its own delta):

- `codex-sdk` → `--base main`
- `codex-runner` → `--base codex-sdk`
- `codex-web` → `--base codex-runner`
- `codex-docs` → `--base codex-web`

Verify each lane's file set is exactly its area before opening PRs (per `AGENTS.md`, diff, do not
eyeball):

```
git diff --name-only main..codex-sdk     # must be only sdks/python/**
git diff --name-only codex-sdk..codex-runner   # must be only services/runner/**
git diff --name-only codex-runner..codex-web   # must be only web/**
git diff --name-only codex-web..codex-docs     # must be only docs/**, .agents/skills/**, .gitignore
```

Trade-off: `codex-runner` is one large PR (34 files spanning the managed, tools, approvals,
subscription, and Daytona work). If reviewers want that broken up, use the concern split below and
pay the file-splitting cost.

### Lane inventories (recommended split)

**Lane 1 `codex-sdk`** (`sdks/python/**`): the adapters and identity
(`agents/adapters/{harnesses,codex_settings,sandbox_agent,__init__}.py`, `agents/dtos.py`,
`agents/__init__.py`), capabilities and catalog (`agents/capabilities.py`, `agents/model_catalog.py`,
`agents/data/codex_models.curated.json`), the wire mirror (`agents/utils/wire.py`,
`agents/wire_models.py`), and the SDK-side tests (unit `agents/**` including the golden fixture and
`test_codex_settings_layers.py`, the integration replay `test_codex_tool_replay.py` plus its
recording and the fake-runner helper).

**Lane 2 `codex-runner`** (`services/runner/**`): the codex asset/env module (`codex-assets.ts`,
`codex-mode.ts`), the environment wiring (`environment.ts`, `environment-setup.ts`,
`runtime-contracts.ts`, `daemon.ts`, `run-plan.ts`, `run-turn.ts`), the runner-side tool gate and MCP
delivery (`tools/executable-tool-gate.ts`, `tools/mcp-bridge.ts`, `tools/tool-mcp-http.ts`,
`engines/sandbox_agent/{mcp,executable-tools,client-tools,acp-interactions}.ts`,
`permission-plan.ts`, `server.ts`, `protocol.ts`), tracing (`tracing/otel.ts`), the image pin
(`docker/Dockerfile.gh`, `docker/Dockerfile.dev`, `package.json`), and the matching runner unit
tests.

**Lane 3 `codex-web`** (`web/**`): `agenta-entity-ui/.../SchemaControls/HarnessSelectControl.tsx`.

**Lane 4 `codex-docs`** (`docs/**`, `.agents/skills/**`, `.gitignore`): the codex-harness design
workspace (`docs/design/codex-harness/**`, ~35 tracked files including this plan, the decision
register, context/design/plan/research, the per-milestone reports and the tracked MP4, the spike
findings and QA drivers; plus the four untracked artifacts flagged below), the agent-workflows
interface-inventory
and ground-truth updates (5 files), the user-facing self-host page
(`docs/docs/self-host/agents/01-use-your-own-subscription.mdx`), the `add-harness` playbook skill
(`.agents/skills/add-harness/{SKILL.md,resources/LESSONS.md}`) with its `.gitignore` allowlist line,
and the `agent-release-gate` codex cell (`.agents/skills/agent-release-gate/resources/{qa_product.py,coverage.md}`).

## Alternative: concern split (5 lanes, smaller PRs, five split files)

If a 34-file runner PR is too large, split the runner and SDK work by concern:

| # | Lane | Concern | PR base |
|---|---|---|---|
| 1 | `codex-sdk-core` | SDK M1/M2: identity, adapters, capabilities, catalog, wire, tools | `main` |
| 2 | `codex-runner-core` | Runner M1/M2: harness wiring, managed `auth.json`, tool/MCP delivery | `codex-sdk-core` |
| 3 | `codex-approvals` | M3: runner-side gate, ACP classification, `codex_settings` layers, `codex-mode` | `codex-runner-core` |
| 4 | `codex-subscription-daytona` | M4/M5: subscription symlink, Daytona managed home, the adapter pin | `codex-approvals` |
| 5 | `codex-docs-web` | docs, web picker, skills, `.gitignore` | `codex-subscription-daytona` |

This split is cleaner to review but is NOT file-disjoint. These files carry pieces of more than one
concern lane and must be split hunk-by-hunk using the sequential working-tree-state recipe in
`AGENTS.md` ("Splitting one file across two stacked lanes"), because their milestone edits overlap in
the same file:

| File | Concern lanes it spans | Milestones |
|---|---|---|
| `services/runner/src/engines/sandbox_agent/environment.ts` | runner-core, approvals, subscription+Daytona | M1, M3, M4, M5 |
| `services/runner/src/engines/sandbox_agent/codex-assets.ts` | runner-core, subscription+Daytona | M1, M4, M5 |
| `services/runner/src/engines/sandbox_agent/environment-setup.ts` | runner-core, approvals, subscription+Daytona | M1, M3, M5 |
| `services/runner/src/engines/sandbox_agent/runtime-contracts.ts` | runner-core, approvals | M1, M3 |
| `services/runner/src/engines/sandbox_agent/run-plan.ts` | runner-core, subscription | M1, M4 |
| `sdks/python/agenta/sdk/agents/adapters/codex_settings.py` | sdk-core, approvals | M1, M3 |
| `sdks/python/agenta/sdk/agents/capabilities.py` | sdk-core (M1/M2), subscription (M4) | M1, M2, M4 |

`environment.ts` is the worst case: it carries all four runner concerns and would be split three
ways. That single file is the reason the area split is recommended. If the concern split is chosen,
follow the `AGENTS.md` git-stash-isolation procedure and verify each lane's tip TREE (not its commit
history) with `git show <lane>:<file>` before pushing.

## Standing rules for the execution session

- The PR base of every lane is the branch directly below it (bottom lane `--base main`), matching the
  repo's stacked-PR convention. Confirm against `origin/main` before each `gh pr create`.
- These are draft-worthy but must not be merged by an agent. Merging is Mahmoud's action; each lane
  stops at green plus "ready to merge".
- The runner image pin (D-005) is verified by the throwaway `install-agent` test and the live Daytona
  run; a full runner-image rebuild is the final confirmation and belongs in the runner lane's CI.
- Do not commit `.desloppify-skill/state.json` or any QA run output; they are local-only.
- **Four workspace artifacts are intentionally left UNTRACKED and must be reviewed before the docs
  lane ships them:** `reports/m1-playground-qa.mp4`, `reports/m3-approvals-qa.mp4`,
  `spike/scenarios-derisk/`, and `spike/transcripts/` (~1.7 MB total). The design-record text
  (context/design/plan/research, all milestone report `.md` files, spike findings and scripts) is
  already committed. The two MP4s are the M1/M3 QA recordings (the M4 MP4 is already tracked); the
  spike transcripts and scenarios are raw derisk byproducts that may contain captured auth payloads,
  so scan them for secrets before `git add`. Decide per artifact whether it belongs in the public
  repo at all.
