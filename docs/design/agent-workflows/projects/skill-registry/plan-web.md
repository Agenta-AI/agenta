# Skill registry — web plan

Reviewed against code 2026-09-05 (Opus review); v2 incorporates the findings.
Two new packages plus host wiring, per package practices. Every UI element extends
the existing component named in ux-plan.md §Component mapping.

## WP-W0 — package bootstrap (before any code compiles)

A new `@agenta/*` package is invisible until registered in SIX allowlists (no
globs anywhere): `web/oss/next.config.ts:91-112` `transpilePackages` +
`web/oss/package.json`; `web/ee/next.config.ts` + `web/ee/package.json`;
`web/storybook/next.config.mjs` `transpilePackages` + `web/storybook/package.json`
(stories glob already picks up `packages/*/src/**` but the build fails without
these); and, when `/m` consumes it, `web/mobile/next.config.ts:13-33`. Then
restart the web dev container (`node_modules` is baked into the image; packages/
edits don't HMR). If `@agenta/skills-ui` ships its own `eslint.config.mjs`, it
MUST spread `restrictedImportPaths`/`restrictedSyntax` or it silently drops the
singleton/barrel bans (`web/packages/eslint.config.mjs:37-74`).

Layering constraint stated precisely: the `*-ui` tier is not flat (entity-ui
itself depends on sessions-ui). What binds us: **`@agenta/entity-ui` must never
import `@agenta/skills-ui`** — every entity-ui → skills call goes through the
host or a `DrillInUIContext` bridge. `@agenta/skills` mirrors `@agenta/sessions`
(deps: entities + shared + sdk).

## WP-W1 — `@agenta/skills`

1. Schema as before (mirror `SkillTemplate`, snake_case storage shape).
2. **API — hard dependency on the A2 dedicated endpoint.** The generated Fern
   client CANNOT send a flags object to `workflows/query` (its request model
   types `flags` as `string|null` and flattens to query params, no body — which
   is why `queryWorkflows` in entities still uses raw axios). `querySkills`
   therefore targets `POST /skills/query` (A2) once its Fern body model exists;
   until then, development uses the entities-style raw call behind the same
   function signature. `getSkillsClient()` accessor lands with W5 (the
   `/skills/sources/*` resources don't exist earlier); regen = generate.sh
   against a running local API + `pnpm --filter @agentaai/api-client build`.
3. State: mirror `evaluatorUtils.ts:80-116`'s ATOM SHAPE (atomWithQuery, focused
   list, 30s staleTime, derived non-archived) but NOT its invalidation —
   `invalidateEvaluatorsListCache` uses `getDefaultStore()+queryClientAtom`;
   skills invalidation uses `getHostQueryClient()` per call.
4. **Embed writer** — corrected contract:
   - Output must round-trip `describeSkill`: emit a SIBLING `name` (and
     `description`) next to `@ag.embed`, because `staticEmbedName`
     (`itemDescriptors.tsx:334-340`) reads `skill.name` / `refs.workflow.name` —
     without it every row renders the raw slug. Verify the resolver tolerates the
     sibling keys (add an API test; the static fixture has none).
   - List mutations are INDEX-BASED, not keyed: the FE writes skills via
     `itemListOps.ts:17-35` (`applyItemToList` append/replace-at-index,
     `removeItemFromList(list, index)`) driven by `useConfigItemDrawer`
     `{kind, mode, index}` — the keyed change-set exists only server-side/agent-
     side. The writer produces entries and index-ops; name-collision handling is
     validation, not list mechanics. Preserve itemListOps' carry-by-reference
     guarantee.
5. `is_skill` into `WorkflowQueryFlags`
   (`entities/src/workflow/core/schema.ts:132-151`); `WorkflowCatalogFlags` lives
   at `api.ts:1442` (not core/schema) and adding `is_skill` there is inert until
   the backend catalog accepts it — pair with an A-row or skip.

## WP-W2 — `@agenta/skills-ui`

1. **SkillDrawer**: extend `SkillFormView` via its EXISTING `disabled` prop
   (`SkillFormView.tsx:52-56` — read-only is already the documented intent; do
   not add a parallel `readOnly`), plus a revision-content source prop.
   `VersionsRailCard` new; `UploadDropCard` reuses the existing zone.
2. **SkillsGallery**: build on `FilterRailLayout` from
   `@agenta/ui/components/presentational` (what `TemplateGallery` itself uses) —
   do NOT copy `TemplateGallery` (its data is hard-coded `AGENT_TEMPLATES`, not a
   prop; copying duplicates the rail/search/section machinery).
3. **SkillPickerDrawer**: `AddSubagentDrawer` is "same anatomy", not "reuse" —
   it has no split-button and no footer slot; those are new. Presentational
   options-in/callbacks-out contract stays.
4. **SkillSaveDialog**: `EntityCommitModal` has the seam —
   `renderModeContent` (+ `onSubmit` override, `EntityCommitModal.tsx:55-115`);
   the modal is adapter-registered, so either add a skills adapter or use the
   `onSubmit` escape hatch (decide at impl., prefer adapter).
5. **Upload states**: `skillUpload.ts` handles folder/.zip/.skill and frontmatter
   BUT cannot produce the 1e states: it takes the FIRST SKILL.md found anywhere
   (no root check → silent empty body), never enumerates multiple SKILL.md, has
   no size caps, and mojibakes binaries. v1: 1c/1d client-side happy path; the
   1e invalid/recovery view is driven by the SERVER scan (A4/A5) — gate it on M3,
   or budget a client parser rewrite (`ParsedSkill[]` signature change).
6. Storybook: stories colocated in the package (main.ts glob covers it) — but
   see W0 registrations; run `pnpm --filter @agenta/storybook lint` AND one build
   (nothing type-checks storybook in CI).

## WP-W3 — host wiring

1. Route: `web/oss/src/pages/w/[ws]/p/[p]/skills.tsx` + **an EE page stub**
   (`web/ee/src/pages/.../skills/index.tsx` re-export — "EE inherits" is FALSE
   for routes; every OSS page dir is mirrored by a 2-line EE stub). App-layer
   pages may not re-export `@agenta/*` directly
   (`web/eslint.config.mjs:47-58`) — `import X…; export default X`, like the EE
   sessions stub. `?skill=` deep link is unclaimed (verified).
2. Sidebar: add `SKILLS_SIDEBAR_KEY` in `agenta-navigation` (constants/registry,
   where the other keys live), insert between AGENTS (`useSidebarConfig:90`) and
   SESSIONS (`:102`); check `mainScope.tsx:64` selected-state.
3. **Rework `itemKinds.skill` — this is a blocker-level task, not a tag tweak.**
   Today `editView`/`jsonOnly` force EVERY embed-ref skill into a raw JSON editor
   titled "Skill reference" (`itemKinds.tsx:174-177`). Under embed-by-default
   that's every row. New behavior: project-owned embed refs open the SkillDrawer;
   unknown/static embed shapes keep the JSON round-trip. Update
   `describeSkill` (version tags from usage/head comparison; drop the redundant
   "skill" tag) against the writer's sibling-name contract (W1.4).
4. Picker seam: replace `handleAddSkill` (`AgentTemplateControl.tsx:494`, wired
   at `:1016` `headerAddButton("Add skill", …)`) via the bridge; row-click path
   is `useConfigItemDrawer.openEdit`.
5. **Bridge**: the skills bridge INTERFACE goes in `@agenta/ui/drill-in`
   (plain data + callbacks, no `@agenta/skills` types — that's how
   `GatewayToolsBridge`/`WorkflowReferenceUI` keep `@agenta/ui` dependency-free);
   the hook implementation in `@agenta/skills-ui`; wired in BOTH hosts:
   `oss/.../OSSdrillInUIProvider.tsx` AND
   `mobile/src/features/chat/DrillInBridgeProvider.tsx` — `/m` renders the same
   entity-ui config surface, so without the mobile wiring `/m` gets a JSON-only
   skills editor with no picker. **The `/m` smoke is mandatory for W3**, not
   conditional.

## WP-W4 — save dialog (RE-SCOPED)

Two different things; only one is in scope:

1. **In scope: the skill-workflow commit.** Editing a skill's body/files is a
   commit on the SKILL workflow — a separate entity that today's agent
   auto-commit (#6126, `agentAutoCommit.ts`) never touches. `SkillSaveDialog`
   wraps THAT commit with the blast-radius panel (usage from A3; note the listed
   follow-latest agents' live sessions are exactly the eviction set — say so in
   the dialog copy). No conflict with auto-commit.
2. **Out of scope / separate decision: agent-side embed edits.** Add/remove/pin
   on `parameters.agent.skills[]` rides the agent revision, which auto-commits by
   design (whole-revision debounced flush; no per-section hook exists). If those
   should confirm too, that's a change to #6126's design — file it as its own
   decision, not a footnote here.

## WP-W5 — import + upload UI

Gated on A5. Absorbs: `getSkillsClient()` accessor; multi-skill client parse
(`ParsedSkill[]`) if the client-side path is kept at all — prefer delegating
validation to the server scan so TS/Python rules can't drift (plan-api A4).

## Risks / gotchas

- Package singleton: `getHostQueryClient()` per call, never cached, never the
  named import.
- `/m` renders shared components without antd vars — no `--ant-color-*`, no
  `border-0 border-b` in `skills-ui`.
- `text-xs` (12px), never `text-sm`; no antd `size="small"`.
- App layer may not re-export `@agenta/*` (route stubs import-then-export).
- Existing inline skills keep working through the current form path; migration
  is an open decision — the itemKinds rework (W3.3) must not break them.
