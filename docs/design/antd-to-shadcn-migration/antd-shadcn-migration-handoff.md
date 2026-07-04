Handoff: antd → shadcn/ui migration (execute through Phase 2)

Date: 2026-07-04 · Previous session: planned + executed Phases 1 and ~half of the Phase-2 settings sweep.

Mission (user's standing instruction)

Take over and complete the migration until Phase 2 is fully achieved (per the 3-phase plan). Make code changes, commit per batch and push — must use branch feat/change-ui-library. Stay on it until done. Fastest + safest; strictly no functional changes; no color theming (shadcn defaults now, brand pass later).

Where everything lives (do not duplicate — read these)

- Execution plan: docs/antd-to-shadcn-migration-plan.md (committed on the branch).
- Persistent memory: ~/.claude/projects/-Users-ashrasfchowdury-Documents-company-agenta/memory/project_shadcn_migration_execution.md — state, gates, and the full component-mapping patterns. Auto-loads; trust it.
- Commits (each message documents its batch + verification): 00030127d5, f3d303ad83, 3527448c54 (Phase 1a/1b/1c), 55848f04ca, 2c3317515b, d1ae6299a1, fba61da951, 899e0bff8a (Phase 2 batches 1–5).

Work environment (critical mechanics)

- Work in the worktree /Users/ashrasfchowdury/Documents/company/agenta/.claude/worktrees/upbeat-matsumoto-58c1cc on local branch code/upbeat-matsumoto-58c1cc (it tracks the same commits). Push with git push origin HEAD:feat/change-ui-library — the branch name itself is checked out in the user's main checkout (which has unrelated uncommitted WIP; never touch it).
- Base branch is big-agents, not main.
- Pre-commit hook runs prettier + turbo lint (enforces import order; a wrong import order aborts the commit — the hook's prettier pass fixes files, then just re-commit).
- Playwright can't run locally (needs backend); the api-keys spec is describe.skipped anyway.

Verification gate (every batch, non-negotiable)

1. cd web/oss && pnpm run types:check 2>&1 | grep -E "error TS" | grep -cv "tests/" must equal 538 (pre-existing baseline on this branch; my changes added zero).
2. Migrated subtree: rg "from \"antd\"|@ant-design" <dir> → empty.
3. Package: cd web/packages/agenta-primitive-ui && pnpm run types:check && pnpm run lint:fix && pnpm run build:css.
4. Prettier the touched app files before committing.

In-flight work (resume exactly here)

WorkspaceManage settings screen (7 files) — migration just started, nothing modified yet:
- Files: WorkspaceManage.tsx (208L), cellRenderers.tsx (259L), Modals/{GenerateResetLinkModal,InviteUsersModal,PasswordResetLinkModal,InvitedUserLinkModal}.tsx, assets/AvatarWithLabel.tsx under web/oss/src/components/pages/settings/WorkspaceManage/.
- Verified: the modals + their Modals/assets/types.d.ts (which extends antd ModalProps/FormInstance) are module-internal only — no oss/ee consumers outside the module, so you may rewrite the prop contracts freely (drop ModalProps, use {open, onClose, ...}).
- InviteUsersModal uses antd Form + dynamic rows (MinusCircleOutlined) → use the FormList wrapper — first real FormList exercise.

Then: Organization (2 files, 1315L — the largest settings screen) → settings module done. Then Phase 2 tracks: Track A codemods for remaining Tier-A volume across the app; Track B composites (EnhancedModal→Dialog repoint in @agenta/ui [62 consumer files], ModelRegistry modals/drawer, Webhook drawer/modals, remaining AlertPopup call sites → shared ConfirmDialog); Track C Form/Table screens ascending risk. Evaluations is excluded from Phase 2 (Phase 3, per plan).

Key gotchas discovered (will bite you otherwise)

- pnpm strict deps: app code can't import sonner directly — use @agenta/primitive-ui/lib/toast re-export. Same principle for any package-internal lib.
- No opacity modifiers on shadcn tokens in app-layer files (bg-destructive/90 silently won't compile under v3). Plain classes only; the package's own files can use them (v4 pipeline).
- Base UI trigger composition uses render={<Button/>} prop (not asChild): TooltipTrigger, DropdownMenuTrigger, etc.
- ToggleGroup value is an array even for single-select: value={[x]} onValueChange={(v)=>v[0] && …}.
- DataTable (@agenta/primitive-ui/components/data-table): ColumnDef + getRowId + onRowClick + optional pageSize (client pagination added for antd-pagination parity).
- The v4 package CSS is compiled by prepare/build:css to dist/styles.css; app imports it in both _app.tsx files. Never re-enable global preflight; the reset is [data-slot]-scoped.
- Edit tool requires Read first; lint hook reformats files after commit attempts — re-stage and re-commit.

Suggested skills

- agenta-package-practices — load before touching web/packages/* or deciding package-vs-app placement (source of truth for the hierarchy rules the plan follows).
- /code-review — run at natural milestones (e.g., settings module complete) before opening the PR; the user hasn't asked for a PR yet — commits+pushes only.
- /handoff — regenerate this doc if you approach limits again.

Status summary for the user (if asked)

Phase 1: done (scaffold fixed on Base UI, isolated v4 CSS + scoped preflight, 29 primitives, Form/DataTable wrappers, Sonner, walking skeleton). Phase 2: 8/10 settings screens fully migrated and pushed (APIKeys, Account, Secrets, Projects, Webhooks, Vault, Triggers, Tools) with the 538-error gate held on every batch; WorkspaceManage and Organization remain, then the app-wide tracks.