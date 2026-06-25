# Playground integration runbook: apply #4850 + reconcile + QA

Step-by-step companion to [`README.md`](./README.md). Run **after** our fix pass lands
on `origin/big-agents`. As of 2026-06-25 the apply is conflict-free; this runbook
re-verifies that against the post-fix-pass tip before doing anything destructive.

References:
- PR head: `f282916e` on `fe-feat/agent-config-panel-onbig`
- big-agents tip at analysis time: `cb9de4c4`
- merge-base: `0c8226ac`

## Phase 0 — Pre-flight verification (read-only)

```bash
cd /home/mahmoud/code/agenta
git fetch origin big-agents fe-feat/agent-config-panel-onbig

# 1. Re-confirm no textual conflict against the CURRENT (post-fix-pass) tip.
MB=$(git merge-base origin/fe-feat/agent-config-panel-onbig origin/big-agents)
git merge-tree "$MB" origin/fe-feat/agent-config-panel-onbig origin/big-agents \
  | grep -iE "CONFLICT|<<<<<<<|changed in both"
# Expect: empty. If not empty, see "If a conflict appears" below.

# 2. Re-confirm our fix pass did not touch any of #4850's 35 FE files.
git diff --name-only "$MB" origin/fe-feat/agent-config-panel-onbig | sort > /tmp/pr_files.txt
git diff --name-only "$MB" origin/big-agents | sort > /tmp/ba_files.txt
comm -12 /tmp/pr_files.txt /tmp/ba_files.txt
# Expect: empty (no overlap). Any line here is a file BOTH sides changed — review it.

# 3. Confirm the interface contracts the FE depends on are still intact on big-agents.
git grep -n 'AGENTA = "pi_agenta"\|PI = "pi_core"\|CLAUDE = "claude"' origin/big-agents -- sdks/python/agenta/sdk/agents/dtos.py
git grep -n 'class ClientToolConfig' origin/big-agents -- sdks/python/agenta/sdk/agents/tools/models.py
git grep -n 'mode: Literal\["agenta", "self_managed"\]' origin/big-agents -- sdks/python/agenta/sdk/agents/wire_models.py
git grep -n 'VERCEL_MESSAGE_PROTOCOL' origin/big-agents -- sdks/python/agenta/sdk/agents/adapters/vercel/routing.py
git grep -n 'x-ag-harness-slug\|_harness_field_schema_extra' origin/big-agents -- sdks/python/agenta/sdk/utils/types.py
# Expect: all present and unchanged in shape. If our fix pass altered any, the FE
# assumption in the matching README §2 row needs re-checking before merge.
```

## Phase 1 — Apply (merge forward, do NOT rebase)

Per project rule, use GitButler, not raw git, for the actual branch ops in the
workspace. The intent:

1. Merge `origin/big-agents` forward into `fe-feat/agent-config-panel-onbig` so it
   carries our fix pass + #4851/#4852.
2. Expected conflicts: **none** today. If the fix pass introduced FE overlap (Phase 0
   step 2 non-empty), resolve **keep-OUR-interface, adapt-his-FE**.

## Phase 2 — Reconciliation commit (R1: harness label drift)

Single concrete edit. In
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/HarnessSelectControl.tsx`:

- The schema property now carries a `oneOf` of `{const, title, x-ag-harness-slug}`.
  Make the control prefer the per-`const` `title` (and optionally the slug) when
  present, before falling back to `HARNESS_META` / `metaFor`.
- At minimum, re-key `HARNESS_META` from `pi`/`claude`/`agenta` to
  `pi_core`/`pi_agenta`/`claude` so `pi_core`→"Pi", `pi_agenta`→"Pi (Agenta)",
  `claude`→"Claude Code" (matching `HARNESS_IDENTITIES`).
- Update the stale JSDoc ("today: pi / claude / agenta").

Commit as a distinct "reconcile harness picker to oneOf/title interface" commit on the
PR branch (stacked on his work, attributable). Then:

```bash
cd web && pnpm lint-fix
# unit tests for the touched packages:
pnpm --filter @agenta/entity-ui test
pnpm --filter @agenta/playground test
pnpm --filter @agenta/entities test
```

## Phase 3 — QA (live stack, config / model-selection path)

Use the `debug-local-deployment` skill; find the active port, log in via Chrome.

| # | Cell | Pass criteria | Tied to |
| --- | --- | --- | --- |
| 1 | Harness picker switch (Pi / Pi (Agenta) / Claude) | correct labels + avatars after R1; value written is `pi_core`/`pi_agenta`/`claude` | R1 |
| 2 | Model catalog pre-creation (draft) | list **populated**, not "No data"; changes per harness | inspect draft-fallback |
| 3 | Model catalog post-commit | resolves from `/inspect harness_capabilities` | model picker |
| 4 | Auth: agenta-managed | run request carries `Connection{mode:"agenta", slug}` + `ModelRef` | Connection |
| 5 | Auth: self-managed | `Connection{mode:"self_managed"}` (no slug); connection picker works | Connection |
| 6 | Custom (client) tool run | request emits `{type:"client",...}`; run does NOT 500 "Unsupported tool configuration shape" | ClientToolConfig |
| 7 | Gateway tool (needs #4749) | connections load; popover fixed-height with Gmail's 61 actions; no panel shift | R3 |
| 8 | `permission_policy` field | shown for Claude, hidden for Pi (`pi_core`/`pi_agenta`) | AgentConfig |
| 9 | Skill add + file upload | round-trips through form ↔ JSON edit | config panel |
| 10 | MCP server add | requires transport target (command/url); JSON editor rejects non-object root | config panel |
| 11 | Create agent from home | create/edit drawer shows agent chat, not blank pane | drawer fix |
| 12 | HITL gated tool | per fix-pass outcome; known clobber if not yet fixed (R2) — not a #4850 regression | R2 |
| 13 | Regression: prompt (non-agent) playground | unaffected | — |

## If a conflict appears (post-fix-pass)

Only possible if our fix pass touched one of #4850's 35 FE files. Default resolution:

- **Schema / wire shape** (harness enum, `oneOf`/`title`, `ClientToolConfig`,
  `Connection`, `ModelRef`, `harness_capabilities`, `VERCEL_MESSAGE_PROTOCOL`): OURS is
  canonical. Adapt his control/request code to read it.
- **Pure UX** (accordion, drawers, editors, popover sizing): take HIS version; that is
  the point of the PR.
- Record any non-obvious call in this file under a "decisions" note for the reviewer.

## Files #4850 touches (35) — overlap watchlist for the fix pass

```
web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx
web/oss/src/components/AgentChatSlice/assets/trace.ts
web/oss/src/components/AgentChatSlice/assets/transport.ts
web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx
web/oss/src/components/Playground/Components/Menus/PlaygroundVariantHeaderMenu/index.tsx
web/oss/src/components/Playground/Playground.tsx
web/oss/src/components/PlaygroundRouter/index.tsx
web/oss/src/components/WorkflowRevisionDrawerWrapper/index.tsx
web/packages/agenta-entities/src/workflow/state/store.ts
web/packages/agenta-entity-ui/package.json
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentConfigControl.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/CodeEditor.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ConfigItemDrawer.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/HarnessSelectControl.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/JsonObjectEditor.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/MarkdownEditor.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/McpServerFormView.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/McpServerItemControl.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SandboxPermissionControl.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SkillFormView.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SkillUploadZone.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ToolFormView.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ToolItemControl.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ToolSelectorPopover.tsx
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentConfigLayout.ts
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/index.ts
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/skillUpload.ts
web/packages/agenta-entity-ui/src/DrillInView/index.ts
web/packages/agenta-playground-ui/src/components/ExecutionHeader/index.tsx
web/packages/agenta-playground/src/state/execution/agentRequest.ts
web/packages/agenta-playground/tests/unit/agentRequest.test.ts
web/packages/agenta-ui/src/components/presentational/index.ts
web/packages/agenta-ui/src/components/presentational/section/ConfigAccordionSection.tsx
web/packages/agenta-ui/src/components/presentational/section/index.tsx
web/pnpm-lock.yaml
```
