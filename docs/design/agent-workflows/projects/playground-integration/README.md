# Playground integration: PR #4850 → big-agents

Integration plan and risk assessment for landing the FE engineer's agent-playground
PR **#4850** ("agent playground config panel + agent run-lane wire fixes", by Arda Erzin)
into `big-agents`, after our current fix pass lands.

- **Read-only analysis.** No code changed, no branch applied, no merge performed.
- Authored 2026-06-25 against `origin/big-agents` tip
  `cb9de4c4` (Merge #4852) and PR head `f282916e`.
- Companion file: [`plan.md`](./plan.md) (step-by-step apply runbook + QA checklist).

## TL;DR

The task framing ("#4850 was built on an OLDER big-agents and may assume a stale
interface") is **largely out of date**. The FE engineer rebuilt #4850 **today**, on a
big-agents that **already contains** the config/model interface rework (#4830 wire
schema, #4839 model picker, #4840 config-structure cleanup). Those three PRs are in
#4850's own history; his lead commit message explicitly says he reconciled onto them
and collapsed out the parts that now live in big-agents verbatim.

Concretely:

- #4850 is **only 4 commits behind** the current big-agents tip.
- Those 4 commits are **backend/SDK skills fixes** (#4851 skills-system review,
  #4852 restore `services/agent/skills` dir). They touch **zero** files that #4850
  touches.
- `git merge-tree` of the two branches reports **no textual conflict**. GitHub also
  reports `MERGEABLE`. The only non-green signal is `mergeStateStatus=UNSTABLE`, which
  is just the pending Railway `deploy` check — every unit/lint/format/build check passes.

So the apply is a **clean, conflict-free fast-merge** today. The remaining risk is
**semantic drift against the model/harness-selection interface**, and there is exactly
one real instance plus a couple of latent ones, all detailed below.

## 1. PR #4850 itself

| Field | Value |
| --- | --- |
| Title | feat(frontend): agent playground config panel + agent run-lane wire fixes |
| Author | Arda Erzin (`ardaerzin`) |
| Base branch | `big-agents` |
| Head branch | `fe-feat/agent-config-panel-onbig` |
| Head SHA | `f282916ec4845f8e3416b59b53f4f8c288f1dfd4` |
| **Merge-base with big-agents** | `0c8226ac` (Merge #4849 docs/subscription-sidecar, 2026-06-25 20:39) |
| Created | 2026-06-25 19:08 |
| Last push | 2026-06-25 20:06 |
| Size | 35 files, +3332 / −728 |
| State | OPEN, MERGEABLE, all CI green (Railway deploy pending) |
| Behind big-agents | **4 commits** (all backend skills, no file overlap) |
| Ahead of big-agents | **7 commits** (1 is a merge of big-agents into the branch) |

### Base SHA + age (the key question)

The PR did **not** branch off a stale big-agents and sit. The author kept it current:

- His lead commit `df266725` (14:44) is dated **after** #4830/#4839/#4840 merged into
  big-agents (13:36–14:05 the same day). All three rework PRs are present in #4850's
  ancestry.
- He then merged `origin/big-agents` again at `9eea2a1` (21:05), resolving one
  conflict in `AgentConfigControl.tsx`.
- Net result: the merge-base is the **#4849 merge** from earlier the same evening.

So "age" is measured in **hours, not weeks**, and the rework is already folded in.

### The 7 PR commits

1. `df266725` feat: agent config-panel UX, reconciled onto settled big-agents (the bulk)
2. `07510740` fix: make the create/edit drawer fully usable for agents
3. `40c572028` feat: declare agent message format via `x-ag-messages-format` header
4. `3936d953` fix: emit agent custom tools as typed client config
5. `e8db4b716` fix: cap agent tool-picker popover height
6. `9eea2a1f` Merge `origin/big-agents` (conflict: `AgentConfigControl.tsx`)
7. `f282916e` fix: address PR review comments on the agent config panel

### What he changed (35 files)

**FE app layer (`web/oss`):**
- `AgentChatSlice/` — `AgentChatPanel.tsx`, `assets/trace.ts`, `assets/transport.ts`,
  `components/AgentMessage.tsx` (inline per-turn run errors, empty-turn collapse,
  `x-ag-messages-format` header).
- `Playground/Components/Menus/PlaygroundVariantHeaderMenu/index.tsx`,
  `Playground/Playground.tsx`, `PlaygroundRouter/index.tsx` (header view-modes, height
  calc, routing).
- `WorkflowRevisionDrawerWrapper/index.tsx` (mount the agent chat panel in the
  create/edit drawer — was rendering blank).

**FE packages:**
- `@agenta/entity-ui` `DrillInView/SchemaControls/` — **the config panel**:
  `AgentConfigControl.tsx` (rewritten as accordion sections), plus new
  `ConfigItemDrawer`, `HarnessSelectControl`, `SandboxPermissionControl`,
  `ToolFormView`, `SkillFormView`, `McpServerFormView`, `CodeEditor`, `MarkdownEditor`,
  `JsonObjectEditor`, `SkillUploadZone`, `agentConfigLayout.ts`, `skillUpload.ts`, and
  edits to `ToolItemControl`, `McpServerItemControl`, `ToolSelectorPopover`, index files.
- `@agenta/entities` `workflow/state/store.ts` (the `/inspect` draft-fallback fix).
- `@agenta/playground-ui` `ExecutionHeader/index.tsx` (hide testset connector for agents).
- `@agenta/playground` `state/execution/agentRequest.ts` + its unit test (the
  custom-tool→client rewrite and the message-format header).
- `@agenta/ui` `presentational/section/ConfigAccordionSection.tsx` (+ index) — new primitive.
- `agenta-entity-ui/package.json`, `pnpm-lock.yaml` (`fflate` → runtime dep).

All FE/TS. **No backend, SDK, or service files.**

## 2. The interface delta (config / model-selection path)

Compared the overlapping interface surfaces between #4850's FE and current big-agents.
Verdict per surface:

| Interface surface | Backend (current big-agents) | #4850 FE | Aligned? |
| --- | --- | --- | --- |
| **Harness values** | `HarnessType`: `pi_core` / `pi_agenta` / `claude` (`AGENTA="pi_agenta"`); default `pi_core` | Reads `schema.enum` for option values; Pi-vs-Claude gating keys off `pi_core`/`pi_agenta`/`claude` | **Functionally yes** (values match). **Label drift** — see §3 |
| **Harness display schema** | Schema ships `oneOf` of `{const, title, x-ag-harness-slug}` with titles `Pi` / `Pi (Agenta)` / `Claude Code` (`HARNESS_IDENTITIES`) | `HarnessSelectControl` ignores the `oneOf`; uses its own hardcoded `HARNESS_META` keyed `pi`/`claude`/`agenta` | **No** (cosmetic) |
| **AgentConfig shape** | `harness` / `sandbox` / `permission_policy` flat run-selection fields + `harness_kwargs` bag, all under `parameters.agent` | Config panel writes the same fields; `LEGACY_RUN_SELECTION_KEYS = ["harness","sandbox","permission_policy"]`; harness_kwargs honored | **Yes** |
| **Connection** | `Connection{mode: "agenta"\|"self_managed", slug?}`; slug only for agenta | Auth cards build exactly `{mode, slug?}` | **Yes** |
| **ModelRef** | `ModelRef{provider?, model, params, connection}` | Picker builds `{provider, model, params, connection}` | **Yes** |
| **Model catalog** | `/inspect` `meta.harness_capabilities` per service | Picker reads `/inspect harness_capabilities`; draft fallback to builtin agent uri; enum fallback if empty | **Yes** |
| **Custom tool shape** | `ClientToolConfig{type:"client", name, description, input_schema}` (+ `permission`/`needs_approval` via `extra="allow"`); `coerce_tool_config` rejects the OpenAI `{type:"function",...}` shape | FE rewrites `{type:"function",function:{...}}` → `{type:"client", name, description, input_schema, permission?, needs_approval?}`; gateway slugs + typed tools pass through | **Yes** |
| **HITL approval rendering** | gated tool that parks still emits a terminal `tool-output-error` for the same `toolCallId`, overwriting the approval state in `useChat` | FE resume path is in place but the terminal denial clobbers it | **Partial — known backend/SDK gap, see §3** |
| **Message format** | `VERCEL_MESSAGE_PROTOCOL = "vercel"` (`sdk/agents/adapters/vercel/routing.py`) | sends `x-ag-messages-format: vercel` | **Yes** |
| **Gateway/MCP tools** | gateway connections need `gateway_connections` table (#4749) | FE ready; picker lights up once #4749 lands | **Yes (dependency, not drift)** |

The big-ticket items the task worried about — model selection, the harness-aware
picker, the AgentConfig shape, connection handling, the pi_core/pi_agenta/claude
rename, AgentConfigControl — are **all already aligned** because the author rebuilt on
top of the rework PRs.

## 3. Conflicts and risks, ranked

No textual merge conflicts exist today. The ranked list is **semantic** risk.

### R1 — Harness label drift (low severity, cosmetic, real)

`HarnessSelectControl.tsx` hardcodes `HARNESS_META` keyed `pi` / `claude` / `agenta`:

```ts
const HARNESS_META = {
    pi: {label: "Pi", short: "Pi", color: "#6b5bd6"},
    claude: {label: "Claude Code", short: "CC", color: "#d97757"},
    agenta: {label: "Agenta", short: "Ag", color: "#1c2c3d"},
}
```

But the real enum values are `pi_core` / `pi_agenta` / `claude`. So `claude` matches,
but `pi_core` and `pi_agenta` **miss the map** and fall through `metaFor()`'s derived
fallback (`formatEnumLabel("pi_core")` → roughly "Pi Core" / "Pi Agenta"), with the
grey fallback avatar color. The control's JSDoc even says "today: pi / claude / agenta",
which is the **stale** assumption.

Meanwhile the backend now publishes the canonical display names in the schema's `oneOf`
`title` (`Pi`, `Pi (Agenta)`, `Claude Code`) plus `x-ag-harness-slug`. The FE reads
neither. Functionally harmless (values are correct, run works), but the labels and
avatars are off and the slug metadata goes unused.

**Resolution (adapt his FE):** in `HarnessSelectControl`, prefer the schema's `oneOf`
`title` per `const` when present, falling back to `HARNESS_META`/`metaFor`. At minimum,
re-key `HARNESS_META` to `pi_core`/`pi_agenta`/`claude`. This is the single concrete
"keep OUR interface, adapt his FE" edit. Do it in the reconciliation commit on top.

### R2 — HITL approval state clobbered (medium, known, not his bug)

A gated tool that parks emits a terminal `tool-output-error` for the same `toolCallId`
in the same turn, which overwrites the approval-request state in `useChat`. The FE
resume path is in place but visually broken until the **backend/SDK** stops emitting
the terminal denial while parked. The PR body flags this as out-of-scope. This is a
runner/SDK fix that belongs to **our fix pass**, not to reconciling #4850. Track it,
don't block on it.

### R3 — Gateway connections need #4749 (medium, dependency)

Third-party (gateway) tools depend on the `gateway_connections` table from #4749. On a
base without that rename, connection endpoints 500
(`relation "tool_connections" does not exist`) and the picker shows no connections. The
FE is ready and lights up once #4749 lands. **Confirm #4749's state on big-agents
before QA'ing the tool picker** — if it isn't in yet, the "add a gateway tool" cell
will fail for a reason unrelated to #4850.

### R4 — Behind on backend skills (low, no overlap)

#4850 is behind #4851/#4852 (skills-system review + `services/agent/skills` dir
restore). These touch `agenta_builtins.py`, the golden `run_request.claude.json`,
wire-contract tests, and `skills.test.ts` — **none** of which #4850 touches. Post-merge
the backend tests are big-agents' own (already green). No action beyond merging
big-agents forward into the branch (or merging the PR, which pulls them in).

### R5 — Our concurrent fix pass overlaps the runner/SDK, not the FE (low for #4850)

Our in-flight fix pass (alias resolver, tracing, gateway-MCP, HITL) is backend/SDK/
runner. #4850 is FE-only. The two do not textually collide. The only coupling is
**behavioral**: R2 (HITL) and any wire-shape change our pass makes must keep the
contracts in the §2 table intact, or #4850's FE assumptions break. As long as our fix
pass preserves `ClientToolConfig`, `Connection{mode,slug}`, `harness` enum values,
`harness_capabilities`, and `VERCEL_MESSAGE_PROTOCOL`, #4850 stays valid.

## 4. Apply + reconcile plan

### Sequencing

Our fix pass lands **first** (as planned). Then integrate #4850. Because there is no
file overlap and no textual conflict, the mechanics are trivial; the work is the
post-merge label fix (R1) and QA.

### Apply mechanism: merge, not rebase

Recommend **merging** big-agents forward into the PR branch (the author already does
this pattern — see `9eea2a1`), then merging the PR. Reasons:

- Merge-tree is conflict-free, so a merge "just works"; a rebase would needlessly
  rewrite his 7 commits and risk re-introducing the `AgentConfigControl.tsx` conflict
  he already resolved at `9eea2a1`.
- The branch already carries a big-agents merge, so its history is merge-based anyway.

Steps (run after our fix pass is on `origin/big-agents`):

1. `git fetch origin big-agents fe-feat/agent-config-panel-onbig`
2. Re-run the conflict probe against the **post-fix-pass** tip:
   `git merge-tree $(git merge-base origin/fe-feat/agent-config-panel-onbig origin/big-agents) origin/fe-feat/agent-config-panel-onbig origin/big-agents`
   — if our fix pass touched any of the 35 FE files (it should not), this surfaces it.
3. Merge `origin/big-agents` into the PR branch to pull #4851/#4852 + our fix pass.
4. Apply the **R1 reconciliation commit** on top (harness label/`oneOf`-title fix).
5. Run `pnpm lint-fix` in `web`, then the package unit tests
   (`agenta-entity-ui`, `agenta-playground`, `agenta-entities`).

### Expected conflicts and resolution

- **Today: none.** The only file the author flagged as historically conflicting is
  `AgentConfigControl.tsx`, already resolved at `9eea2a1`.
- **If our fix pass edited any of the 35 FE files** (unlikely — it's backend/runner):
  default rule is **keep OUR interface, adapt his FE**. For config/model-selection
  specifically, OUR schema (`oneOf`/`title`/`x-ag-harness-slug`, the `ClientToolConfig`
  / `Connection` / `ModelRef` shapes) is canonical; his control code adapts to read it.

### Stacked PR with reconciliation on top — yes

Land the R1 fix (and any QA-driven follow-ups) as a **reconciliation commit stacked on
#4850's branch**, not folded silently into his commits. Keeps his authored UX work
attributable and isolates "what we changed to fit the current interface" for review.
Practically: commit on `fe-feat/agent-config-panel-onbig`, push, let #4850 update.
A separate stacked PR is overkill since there is no conflict to isolate; one extra
commit on his branch is enough.

## 5. Post-apply QA focus

The end-to-end **playground ↔ backend config / model-selection** path is what to
exercise. Detailed cells in [`plan.md`](./plan.md). Priorities:

1. **Harness picker** (R1): switch between Pi / Pi (Agenta) / Claude. Confirm labels and
   avatars are correct after the R1 fix (regression target for the drift).
2. **Model catalog from `/inspect`**: pre-creation (uncommitted draft) the model list is
   **populated, not "No data"** (the draft-fallback fix), and the list changes per
   harness (`harness_capabilities`).
3. **Connection / auth cards**: agenta-managed vs self-managed; confirm the run request
   carries `Connection{mode, slug?}` (slug only for agenta) and `ModelRef`.
4. **Custom (client) tool**: add a schema-only function tool, run; confirm the request
   emits `{type:"client", ...}` and the run does **not** 500 with "Unsupported tool
   configuration shape".
5. **Gateway tool**: only meaningful if #4749 is in big-agents (R3). Confirm the picker
   loads connections and the popover stays fixed-height with many actions (Gmail = 61).
6. **`permission_policy`**: visible for Claude, hidden for Pi (`pi_core`/`pi_agenta`).
7. **Create/edit drawer**: create an agent app from home → the drawer shows the agent
   chat, not a blank pane.
8. **HITL** (R2): expect the known clobber unless our fix pass resolved it; verify
   against the fix-pass outcome rather than treating it as a #4850 regression.
9. **Regression**: the prompt (non-agent) playground is unaffected.

Run against the live stack via the `debug-local-deployment` skill once merged.
