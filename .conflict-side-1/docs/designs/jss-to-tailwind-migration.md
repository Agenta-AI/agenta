# JSS → Tailwind migration inventory

Branch: fe-feat/ui-dark-mode · generated 2026-05-30

**Context:** 54 live JSS (`createUseStyles`) files (1 dead deleted: `useTreeStyles.ts`; + dead shim `TestcaseEditDrawerContent.tsx`). 47/54 already use `theme.*` tokens and are dark-aware via ThemeContextBridge, so **this migration is tech-debt/consistency, not a dark-mode blocker**. Per AGENTS.md: prefer Tailwind; CSS-in-JS acceptable only for complex antd overrides.

**Legend** — Target: `TW`=Tailwind classes, `[&_.ant-*]`=Tailwind arbitrary variant for antd overrides, `clsx`=conditional classes, `antd components`=ConfigProvider token. Effort: S<30m, M~1-2h, L~half-day.

## Tier 1 — Quick wins (pure Tailwind) — 16 files

| File | lines | rules | theme | prop | antd | Effort | Plan |
|---|--:|--:|:--:|:--:|:--:|:--:|---|
| `components/pages/testset/modals/CreateTestsetFromScratch.tsx` | 183 | 2 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/pages/app-management/modals/EditAppModal/index.tsx` | 100 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/pages/app-management/components/HelpAndSupportSection.tsx` | 83 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/Placeholders/NoMobilePageWrapper/NoMobilePageWrapper.tsx` | 70 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/Placeholders/NoResultsFound/NoResultsFound.tsx` | 63 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/CustomUIs/LabelValuePill.tsx` | 53 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/Spinner/ContentSpinner.tsx` | 52 | 2 |  |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/CustomUIs/CustomTreeComponent/assets/styles.ts` | 49 | 3 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/pages/app-management/components/EmptyAppView.tsx` | 47 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/ResultComponent/ResultComponent.tsx` | 44 | 2 |  |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `ee:components/PostSignupForm/assets/styles.ts` | 33 | 3 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/ResultTag/assets/styles.ts` | 31 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/SharedDrawers/TraceDrawer/components/TraceSidePanel/TraceDetails/assets/styles.ts` | 28 | 3 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/pages/app-management/components/WelcomeCardsSection/assets/styles.ts` | 26 | 2 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/Playground/Components/PlaygroundVariantConfig/assets/styles.ts` | 12 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |
| `components/Playground/Components/PlaygroundPromptComparisonView/PromptComparisonVariantNavigation/assets/VariantNavigationCard/styles.ts` | 11 | 1 | ✓ |  |  | S | Pure Tailwind classes (token color classes where needed). |

## Tier 2 — Medium (antd variants / prop logic) — 28 files

| File | lines | rules | theme | prop | antd | Effort | Plan |
|---|--:|--:|:--:|:--:|:--:|:--:|---|
| `ee:components/DeploymentHistory/DeploymentHistory.tsx` | 430 | 10 | ✓ |  |  | M | Tailwind classes; a few rules to translate. |
| `components/pages/testset/modals/UploadTestset.tsx` | 288 | 5 | ✓ |  |  | M | Tailwind classes; a few rules to translate. |
| `components/pages/observability/dashboard/AnalyticsDashboard.tsx` | 242 | 4 | ✓ | ✓ |  | M | Replace prop-driven styles with clsx conditionals (or data-attrs) + Tailwind. |
| `components/pages/app-management/modals/CreateAppStatusModal.tsx` | 237 | 6 | ✓ |  |  | M | Tailwind classes; a few rules to translate. |
| `components/pages/testset/modals/CreateTestsetFromApi.tsx` | 191 | 5 | ✓ |  |  | M | Tailwind classes; a few rules to translate. |
| `components/SharedDrawers/TraceDrawer/components/TraceSidePanel/index.tsx` | 160 | 3 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/testset/modals/components/FilePreviewTable.tsx` | 155 | 10 | ✓ |  |  | M | Tailwind classes; a few rules to translate. |
| `components/DynamicCodeBlock/CodeBlock.tsx` | 142 | 2 |  | ✓ |  | M | Replace prop-driven styles with clsx conditionals (or data-attrs) + Tailwind. |
| `components/pages/overview/deployments/DeploymentModal.tsx` | 116 | 2 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/observability/dashboard/widgetCard.tsx` | 99 | 4 | ✓ | ✓ |  | M | Replace prop-driven styles with clsx conditionals (or data-attrs) + Tailwind. |
| `ee:components/pages/app-management/components/DemoApplicationsSection.tsx` | 97 | 1 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/DynamicCodeBlock/DynamicCodeBlock.tsx` | 93 | 4 |  | ✓ |  | M | Replace prop-driven styles with clsx conditionals (or data-attrs) + Tailwind. |
| `components/pages/app-management/modals/SetupTracingModal/assets/styles.ts` | 91 | 5 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/testset/modals/index.tsx` | 89 | 1 |  |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/app-management/modals/MaxAppModal.tsx` | 88 | 2 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/Placeholders/EmptyComponent/index.tsx` | 82 | 1 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/evaluations/NewEvaluation/assets/styles.ts` | 81 | 6 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/prompts/modals/MoveFolderModal.tsx` | 79 | 1 |  |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/SharedDrawers/TraceDrawer/components/TraceContent/assets/styles.ts` | 52 | 4 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/Filters/assets/styles.ts` | 44 | 4 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/evaluations/onlineEvaluation/assets/styles.ts` | 44 | 2 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/SharedDrawers/TraceDrawer/components/TraceTree/assets/styles.ts` | 36 | 5 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/app-management/modals/CustomWorkflowModal/assets/styles.ts` | 36 | 4 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/auth/assets/style.ts` | 32 | 5 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/DeploymentsDashboard/components/DeploymentCard/styles.ts` | 30 | 1 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/pages/app-management/assets/styles.ts` | 26 | 0 | ✓ | ✓ |  | M | Replace prop-driven styles with clsx conditionals (or data-attrs) + Tailwind. |
| `components/pages/app-management/components/ObservabilityDashboardSection.tsx` | 25 | 1 |  |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |
| `components/SharedDrawers/TraceDrawer/components/TraceSidePanel/TraceAnnotations/assets/styles.ts` | 22 | 1 | ✓ |  | ✓ | M | TW arbitrary-variants `[&_.ant-*]:` for the antd overrides; token color classes for the rest. |

## Tier 3 — Complex (large + antd-deep + prop) — 10 files

| File | lines | rules | theme | prop | antd | Effort | Plan |
|---|--:|--:|:--:|:--:|:--:|:--:|---|
| `components/SharedDrawers/TraceDrawer/components/AccordionTreePanel.tsx` | 668 | 1 | ✓ | ✓ | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/pages/testset/modals/CreateTestset.tsx` | 476 | 9 | ✓ |  | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints/index.tsx` | 347 | 2 | ✓ | ✓ | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/TestcasesTableNew/components/ImportTestsetRevisionModal.tsx` | 332 | 6 | ✓ |  | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/pages/prompts/components/PromptsBreadcrumb.tsx` | 323 | 1 | ✓ |  | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/Filters/Sort.tsx` | 320 | 5 | ✓ | ✓ | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/pages/evaluations/cellRenderers/cellRenderers.tsx` | 302 | 6 | ✓ |  | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/SharedDrawers/TraceDrawer/components/TraceContent/components/AnnotationTabItem/index.tsx` | 232 | 2 | ✓ | ✓ | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/pages/overview/deployments/ChangeVariantModal.tsx` | 143 | 2 | ✓ | ✓ | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |
| `components/Layout/assets/styles.ts` | 110 | 6 | ✓ | ✓ | ✓ | L | TW arbitrary-variants `[&_.ant-*]` + clsx for prop logic; move pure antd token theming to ConfigProvider `components`. Migrate last. |

## Summary

- Total live JSS: 54
- Tier 1 (S): 16 · Tier 2 (M): 28 · Tier 3 (L): 10
- antd-deep overrides: 28 · prop-based: 11 · use theme tokens: 47

**Recommended sequencing:** Tier 1 first (mechanical, low risk), then Tier 2 by area, Tier 3 last (each its own PR, with visual QA). None blocks dark mode.

## Migration status

- Tier 1: 15/16 migrated. Still skipped: `CustomTreeComponent/assets/styles.ts`
  (`::before` tree-connector pseudo-elements).
- Tier 2: 27/28 migrated. The 4 previously-skipped var-gated files (SetupTracingModal,
  NewEvaluation, auth, DeploymentCard styles) are now migrated — this required adding 5 missing
  `--ag-*` token vars (`colorBgContainerDisabled`, `colorInfoBg`, `controlItemBgActive`,
  `colorError`, `colorErrorBorder`) plus a var-backed `boxShadowTertiary` (`shadow-tertiary`).
  Still skipped: `app-management/assets/styles.ts` (prop-driven non-token pair).
- Tier 3: not started (10 files) — each warrants its own PR with per-file visual QA.
