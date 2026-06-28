# Aligning the config section drawers with the `agent-template` redesign

Status: planning only. No code changes yet. This maps JP's agent-template change list
(`agent-template.md` / `agent-parameters.md`) onto the config-section-drawers frontend so we can
execute quickly once the schema lands.

## Premise (read first)

- The redesign is **not implemented**. There is no JP branch on `origin` implementing it (his latest
  is `big-agents` itself); the docs' source paths point at a separate private monorepo
  (`/Users/junaway/Agenta/github/application/...`), not this repo. The schema here still emits the old
  shape: `services/oss/src/agent/schemas.py` → `x-ag-type-ref: "agent_config"`; `AgentConfigSchema`
  with flat `agents_md` / `model` (flat string) / `tools` / `mcp_servers` / `harness` (scalar) /
  `sandbox` / `permission_policy` / `sandbox_permission` / `skills`.
- **The frontend follows the schema PR, not the other way round.** The new template, schema, and
  UI-primitives land first (next); we align to them.

## What is NOT changing (locked)

- **Our config sections and drawers stay exactly as designed**: Model & harness, Instructions, Tools,
  Skills, MCP servers, Advanced. The agent panel stays **one composed panel** with our summary +
  drawer pattern. The top-level "Agent" collapse stays removed (recent commit) — that is the same
  principle: **we own the panel layout**.
- **JP's "four siblings" (`agent` / `harness` / `runner` / `sandbox`) is a schema/data restructure,
  not a frontend layout.** He is not deciding our UI sections. So "four sibling groups vs one composed
  panel" is **not an open question** — composed panel, our sections, decided. Our control composes its
  own UX across whatever objects the schema exposes.

The redesign therefore lands as two pieces of FE work, neither of which touches our section layout:
**(A)** re-point where each unchanged drawer reads/writes its data, and **(B)** use the new schema +
UI-primitives to drive the drawer inner logic and remove hardcoding.

## Part A — keep the UX, re-point the data plumbing

The four-sibling split means our unchanged drawers source their fields from different objects. The
composed panel (today `AgentConfigControl`, renamed `AgentTemplateControl`) reaches across the sibling
objects to assemble the same drawers. Cross-object access is the chosen approach, not a question.

| Our drawer (unchanged UX) | Sources today (flat `agent_config`) | Sources after the redesign |
| --- | --- | --- |
| Instructions | `agents_md` | `agent.instructions.agents_md` |
| Model & harness | `model`, `harness` | `agent.llm` (model/provider/connection/extras) + sibling `harness` |
| Tools | `tools` (`type:`) | `agent.tools[]` (`kind:`) |
| MCP servers | `mcp_servers` | `agent.mcps[]` (a tool *source*) |
| Skills | `skills` | `agent.skills[]` (a tool *source*) |
| Advanced | `sandbox`, `sandbox_permission`, `permission_policy`, Claude perms, auth | `agent.llm.connection` (auth) + sibling `sandbox` + `runner.approvals` + `harness.permissions` |

The two drawers that pull from the most places are **Model & harness** (now `agent.llm` + sibling
`harness`) and **Advanced** (now spread across `llm`, `sandbox`, `runner`, `harness`). The UX of both
stays as-is; only the field plumbing behind them changes.

## Part B — drive the inner logic from the schema + UI-primitives (remove hardcoding)

This is the upside of the redesign. Our control hardcodes a lot today; the new schema's markers,
reused primitives, and the incoming UI-primitives let us drive more from the schema and delete
hand-coded coupling. Targets:

| Hardcoding today | Schema-driven replacement |
| --- | --- |
| The literal `"agent_config"` id in 6+ places (detection, dispatch, our collapse code) | One shared catalog-id constant/helper; accept the new `agent-template` ref in a single place, not scattered string checks. |
| `AgentConfigControl` reads fields by literal key (`props.model`, `props.harness`, `props.sandbox`, `props.permission_policy`, `props.sandbox_permission`, `props.agents_md`, `props.tools`, `props.mcp_servers`, `props.skills`) | Locate each drawer's data by its `x-ag-type-ref` marker on the schema sub-node, not by hardcoded key. The redesign gives stable markers (`llm`, `connection`, `schemas`, `parameters`, `references`) to dispatch on. |
| The Advanced drawer hand-groups which fields live where | Group by schema marker / metadata instead of a hardcoded field list. |
| Tool / MCP / skill editors hardcode the `type` discriminator and per-kind fields | Uniform entry `{ kind, name, permissions, isolation, <named optional>, extras }`: render named fields from the schema, and render the untyped `extras` bag with **one generic key/value editor reused across every kind** (harness/sandbox/runner/tool/llm all use the same `extras` shape — CHANGE-4). |
| Bespoke per-concern controls (`HarnessSelectControl`, `SandboxPermissionControl`, etc.) carry kind-specific knowledge | Keep the typed, common parts (`permissions`) as real controls; push kind-specific knobs into the shared `extras` editor. The redesign reuses existing primitives on purpose (`schemas` = `x-ag-type-ref: schemas`, `parameters`, `connection` slug, `@ag.references`), so we reuse our existing controls instead of hardcoding new shapes. |
| `model` field / `params` naming | `model` → `llm`, `params` → `extras`; the connection picker (`connectionUtils.ts`, already ModelRef-based and `harness_capabilities`-driven) carries over with minimal change. |

When the **UI-primitives** doc/components arrive, map the drawer inner controls onto them as they
land (especially the generic `extras` editor and the reused `schemas` / `parameters` / `connection`
editors). The goal: our drawer shells stay; their innards become schema-rendered, not hand-built.

## Rename surface (`agent_config` → `agent-template`)

CHANGE-R1 renames the catalog id and ref; CHANGE-R2/R3 rename `AgentConfigSchema` → `AgentTemplate`
and `AgentConfigControl` → `AgentTemplateControl`. The frontend hardcodes the old id here — centralize
into one constant while renaming:

- `packages/agenta-playground/src/state/execution/selectors.ts:1269` — `isAgentMode` detection.
- `packages/agenta-entity-ui/src/DrillInView/SchemaControls/SchemaPropertyRenderer.tsx:99,130-131,430`
  — the dispatch union, the `x-ag-type-ref` check, the `case`.
- `packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx:1565-1566,1778-1779`
  — the top-level-collapse suppression we shipped (still wanted; just keyed on the new ref).
- Comments/labels: `AgentConfigControl.tsx:9,14`, `McpServerItemControl.tsx:9`,
  `SandboxPermissionControl.tsx:11`, `HarnessSelectControl.tsx:4`,
  `PlaygroundVariantHeaderMenu/index.tsx:35`.

## New template capabilities = additive sections (our call, not a restructure)

The redesign adds concepts with no current home. These do not change the existing sections; they are
**additive** drawers/sections we introduce when the capability lands, on our terms:

- **`runner.loop`** (`timeouts` + `limits`) and **`runner.approvals`** (`decision` + `channel`) — the
  first net-new authoring surface; likely folds into Advanced or a small new "Run" area.
- **`assets[]`** — read-only workspace files; a file-list section like Instructions.
- **`directories[]`** — mounted storage (`slug`/`mount`/`access`/`durability`).
- **`agents[]`** — recursive subagents (`AgentTemplate` + `isolation` + delegation `permissions`);
  the largest new build.
- **`runner.hooks`** — gated on OPEN-7 (may not be expressible for harnesses we don't control); ship
  last.

## Genuinely open questions (schema/spec only — not FE layout)

1. **OPEN-1** (`agent:v0` vs `harness:v0`) — naming of the runtime slug; affects detection naming,
   not field shape. The catalog-id rename (R1) is independent and can proceed.
2. **OPEN-7** — can the runner observe a *step*? Gates whether `runner.hooks` exist at all.
3. **Final tool `kind` set and named-optional-vs-`extras` split** — confirm before reworking the tool
   editors (docs are explicit but tagged illustrative).

## Sequenced execution (once the schema + UI-primitives land)

1. **Renames (mechanical).** `agent_config` → `agent-template` at the detection/dispatch points
   above, centralized into one constant; `AgentConfigControl` → `AgentTemplateControl`. Panel renders
   unchanged against the new id.
2. **Re-point plumbing (Part A).** Source each unchanged drawer from its new object location; the
   composed panel reaches across the four siblings. Top-level collapse stays removed.
3. **De-hardcode inner logic (Part B).** Incrementally replace literal-key access with marker-driven
   lookup; introduce the shared `extras` editor; adopt the UI-primitives as they arrive.
4. **Additive capabilities.** `runner.loop` + `approvals`, then `assets` / `directories`, then
   `agents[]`; `runner.hooks` last (OPEN-7).

## What stays valid from the work already shipped

- The whole **section + drawer** structure (summary + `SectionDrawer` / `ConfigItemDrawer`,
  draft+Save) is unaffected — it is layout we own, independent of the schema shape.
- The **Instructions drawer**, **Tools / Skills / MCP** sections, and the **model/connection picker**
  carry over directly; only field sourcing and entry shapes change.
- Removing the top-level "Agent" collapse remains correct: it asserts that we compose the panel, which
  is exactly why the four-sibling schema split does not change our layout.
