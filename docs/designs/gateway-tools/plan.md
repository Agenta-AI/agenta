# Gateway Tools Remediation Plan

## Why this plan exists

We ran a branch-wide review for `feat/add-gateway-tools` using:

- React best practices (`vercel-react-best-practices`)
- Web design/accessibility guidelines (`web-design-guidelines`)
- Repository engineering conventions (`AGENTS.md`)

This plan records the prioritized fixes so they are not lost as chat context evolves.

## Goals

1. Eliminate high-risk issues before merge (security, architectural duplication, state/query correctness).
2. Improve UX and accessibility for gateway tools flows.
3. Align new code with AGENTS.md conventions (query/state patterns, reusable components, theming).

## Non-goals

- Re-architecting the entire tools domain in one pass.
- Large visual redesign beyond targeted UX fixes.
- Backfilling every minor suggestion before shipping core fixes.

## Prioritized workstreams

### P0 (must-fix)

1. **OAuth callback postMessage origin hardening**
   - Issue: `window.opener.postMessage(..., "*")` in tools OAuth callback page.
   - Risk: cross-origin message leak.
   - Files: `api/oss/src/apis/fastapi/tools/router.py`

2. **Deduplicate shared drawer helpers**
   - Issue: duplicated `useDebouncedAtomSearch`, `ScrollSentinel`, `ScrollToTopButton`.
   - Risk: drift/bugs and maintenance overhead.
   - Files: `web/oss/src/features/gateway-tools/drawers/CatalogDrawer.tsx`, `web/oss/src/features/gateway-tools/drawers/ToolExecutionDrawer.tsx`

3. **Replace manual useEffect data fetching with atomWithQuery**
   - Issue: imperative fetch in `ConnectionManagerDrawer`.
   - Risk: inconsistent cache/loading/error behavior vs app standards.
   - Files: `web/oss/src/features/gateway-tools/drawers/ConnectionManagerDrawer.tsx` (+ new selector atom file)

### P1 (should-fix)

4. **Unify integration detail hooks/query keys**
   - Issue: duplicate hooks with diverging query keys/stale times for same data.
   - Files:
     - `web/oss/src/features/gateway-tools/hooks/useIntegrationDetail.ts`
     - `web/oss/src/features/gateway-tools/hooks/useIntegrationInfo.ts`
     - `web/oss/src/components/pages/settings/Tools/hooks/useIntegrationDetail.ts`

5. **Reduce duplicate drawer mounts per screen context**
   - Issue: multiple mounts of shared drawers in playground/settings trees.
   - Files:
     - `web/oss/src/components/Playground/Components/PlaygroundVariantConfigPrompt/assets/ActionsOutputRenderer.tsx`
     - `web/oss/src/components/Playground/Components/PlaygroundVariantConfigPrompt/assets/GatewayToolsPanel.tsx`
     - `web/oss/src/components/pages/settings/Tools/components/GatewayToolsSection.tsx`

6. **Accessibility: icon-only controls need aria labels**
   - Issue: missing `aria-label` in multiple icon-only buttons.
   - Files: gateway-tools drawers/components + settings table actions.

### P2 (nice-to-have but important)

7. **Theme alignment: reduce hardcoded colors in key surfaces**
   - Issue: hardcoded hex values hurt dark-mode consistency.
   - Files: `ActionsOutputRenderer.tsx`, `SchemaForm.tsx`, `ResultViewer.tsx`, plus touched settings/playground spots.

8. **Minor consistency improvements**
   - Placeholder typography (`...` -> `…`)
   - Inline array props cleanup where practical
   - Add `overscroll-contain` in drawers where useful

## Execution order

We will execute fixes one by one in this order:

1. P0.1 OAuth postMessage origin hardening
2. P0.2 Deduplicate drawer helpers
3. P0.3 atomWithQuery migration for `ConnectionManagerDrawer`
4. P1.4 Integration hook unification
5. P1.5 Drawer mount consolidation
6. P1.6 Accessibility aria labels
7. P2.7 Theme alignment pass
8. P2.8 Consistency pass

## Validation per step

For each completed step:

- Run focused checks for touched packages/files.
- If frontend touched: run lint/format in `web` (`pnpm lint-fix` as applicable).
- If API touched: run `ruff format` + `ruff check --fix` in API scope as needed.
- Update `status.md` with what changed, decisions, and follow-ups.

## Current status

- Plan established and tracked.
- Implementation begins with P0.1.
