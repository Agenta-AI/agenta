import {memo, useCallback, useMemo, useState} from "react"

import {
    activateEvaluatorEnrichmentAtom,
    nonHumanEvaluatorsAtom,
    nonArchivedAppWorkflowsAtom,
    nonArchivedEvaluatorsAtom,
    parseWorkflowKeyFromUri,
    type Workflow,
    type WorkflowType,
    workflowAppTypeAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {ArrowsLeftRight, X} from "@phosphor-icons/react"
import {Button, Dropdown, type MenuProps, Tooltip} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import useURL from "@/oss/hooks/useURL"
import {recentAppIdAtom, routerAppNavigationAtom} from "@/oss/state/app/atoms/fetcher"
import {requestNavigationAtom} from "@/oss/state/appState"
import {
    currentWorkflowContextAtom,
    EVALUATOR_FULL_PAGE_NAV_ENABLED,
    recentEvaluatorIdAtom,
} from "@/oss/state/workflow"

interface WorkflowEntityCardProps {
    collapsed: boolean
}

// Stable empty atom read while the switcher is dormant, so swapping it in for
// `nonHumanEvaluatorsAtom` keeps the evaluator latest-revision fan-out unmounted
// until the switcher is first opened.
const EMPTY_EVALUATORS: readonly Workflow[] = []
const EMPTY_EVALUATORS_ATOM = atom<readonly Workflow[]>(EMPTY_EVALUATORS)

/**
 * Single row inside the switcher dropdown — name + per-kind type tag.
 *
 * Subscribes to per-entity atoms so the type info batches automatically
 * via the entity-package's batched latest-revision fetcher (same pattern
 * as the table cells in `appWorkflowColumns`/`evaluatorColumns`).
 */
const SwitcherRow = memo(
    ({
        workflowId,
        label,
        isEvaluator,
    }: {
        workflowId: string
        label: string
        isEvaluator: boolean
    }) => {
        // Apps resolve their type via the latest-revision-derived atom.
        const appType = useAtomValue(workflowAppTypeAtomFamily(workflowId)) as WorkflowType | null
        // Evaluators need the URI from the latest revision to derive the
        // template key (e.g. `auto_exact_match`). The query is batched.
        const latestRevision = useAtomValue(
            workflowLatestRevisionQueryAtomFamily(isEvaluator ? workflowId : ""),
        )
        const evaluatorKey = useMemo(() => {
            if (!isEvaluator) return null
            const uri = (latestRevision.data?.data as {uri?: string} | undefined)?.uri
            return parseWorkflowKeyFromUri(uri ?? null)
        }, [isEvaluator, latestRevision.data])

        return (
            <div className="flex items-center gap-2 min-w-0">
                <span className="truncate flex-1 min-w-0" title={label}>
                    {label}
                </span>
                <WorkflowTypeTag
                    isEvaluator={isEvaluator}
                    workflowKey={evaluatorKey}
                    evaluatorTypeKey={appType}
                    workflowType={appType}
                    className="shrink-0"
                />
            </div>
        )
    },
)
SwitcherRow.displayName = "WorkflowEntityCard.SwitcherRow"

// Tailwind arbitrary-variant selectors target Ant's dropdown-menu group-title
// element so "Apps" / "Evaluators" stick to the top of the scroll container as
// the user scrolls past their items. The opaque background + z-index keep them
// readable when items pass underneath.
//
// NOTES:
// - When a `menu` prop is passed to `Dropdown`, AntD renders an
//   `.ant-dropdown-menu` (NOT `.ant-menu`), so the title class is
//   `.ant-dropdown-menu-item-group-title`.
// - `position: sticky; top: 0` sticks to the inside of the scroll container's
//   padding box. AntD's menu has its own `padding-top`, which would otherwise
//   leave a strip where scrolled items show through above the sticky header —
//   we zero out the top padding so the header sits flush.
const SWITCHER_MENU_CLASS = clsx(
    "max-h-80 overflow-y-auto !pt-0",
    "[&_.ant-dropdown-menu-item-group-title]:sticky",
    "[&_.ant-dropdown-menu-item-group-title]:top-0",
    "[&_.ant-dropdown-menu-item-group-title]:z-10",
    "[&_.ant-dropdown-menu-item-group-title]:!bg-[var(--ant-color-bg-elevated)]",
    "[&_.ant-dropdown-menu-item-group-title]:!text-[var(--ant-color-text-secondary)]",
    "[&_.ant-dropdown-menu-item-group-title]:!pb-2",
)

/**
 * Entity-level "in this workflow" card shown above the app-section sidebar
 * items (overview / playground / registry / evaluations / observability).
 *
 * Renders the active workflow's name + a `WorkflowTypeTag` (chat/completion
 * for apps, evaluator template name for evaluators). The replace icon opens
 * a switcher grouped by kind (apps + evaluators); the close icon exits the
 * entity context and returns to the apps listing.
 *
 * On collapsed sidebars only the type tag and a compact switcher remain.
 */
const WorkflowEntityCard = memo(({collapsed}: WorkflowEntityCardProps) => {
    const ctx = useAtomValue(currentWorkflowContextAtom)
    // Latch: flips true on first switcher-open and never resets, so the full
    // apps/evaluators catalogs resolve LAZILY (on open) instead of on sidebar
    // mount, then stay warm (cached, no flicker on reopen).
    const [switcherActivated, setSwitcherActivated] = useState(false)
    // The full apps + evaluators lists are needed in exactly two situations: to
    // populate the switcher dropdown (once opened), and to resolve a recently
    // visited workflow for the no-current-workflow fallback (routes that point at
    // no workflow, e.g. /home). On a workflow route with the switcher closed we
    // need NEITHER, so we read stable empty atoms to avoid pulling the whole apps
    // and evaluator catalogs on every page load. Gate on `workflowId` (the URL id,
    // parsed synchronously from the initial location → truthy from the FIRST
    // render), NOT on `workflow` (null while resolution is in flight, which would
    // still fire the catalogs during the loading window).
    const wantWorkflowLists = !ctx.workflowId || switcherActivated
    const apps = useAtomValue(
        wantWorkflowLists ? nonArchivedAppWorkflowsAtom : EMPTY_EVALUATORS_ATOM,
    ) as readonly Workflow[]
    const evaluators = useAtomValue(
        wantWorkflowLists ? nonArchivedEvaluatorsAtom : EMPTY_EVALUATORS_ATOM,
    ) as readonly Workflow[]
    // The switcher lists every AUTOMATIC evaluator — LLM, code, AND the
    // declarative classifiers (exact match, regex, similarity / semantic
    // similarity, json diff, contains json, …). `nonHumanEvaluatorsAtom`
    // resolves `is_feedback` from each evaluator's LATEST REVISION — the
    // workflow LIST records this card reads from `nonArchivedEvaluatorsAtom`
    // carry NO `is_feedback`/`is_llm`/`is_code` flags (those live on the
    // revision, not the parent artifact), which is why the old
    // `!w.flags?.is_feedback` filter never excluded anything and human
    // evaluators leaked in (QA 2026-06-05). It drops ONLY human (`is_feedback`)
    // evaluators; navigation lands on the workflow's current sub-page (Overview/
    // Evaluations are valid for every evaluator), so matchers no longer dead-end.
    //
    // LAZY: that latest-revision resolution fans out one batched
    // POST /workflows/revisions/query over EVERY evaluator in the project, and
    // it's only needed to populate the switcher dropdown. `nonHumanEvaluatorsAtom`
    // sits behind the shared enrichment gate (dormant → empty until activated),
    // and we activate it on first switcher-open (see `handleSwitcherOpenChange`),
    // so a plain sidebar mount never triggers the fan-out. While the
    // `EVALUATOR_FULL_PAGE_NAV_ENABLED` flag is off we read a stable empty atom
    // instead, so the "Evaluators" group stays hidden regardless of whether some
    // other consumer has activated the gate.
    const switcherEvaluators = useAtomValue(
        EVALUATOR_FULL_PAGE_NAV_ENABLED ? nonHumanEvaluatorsAtom : EMPTY_EVALUATORS_ATOM,
    ) as readonly Workflow[]
    const recentAppId = useAtomValue(recentAppIdAtom)
    const recentEvaluatorId = useAtomValue(recentEvaluatorIdAtom)
    const navigateToWorkflow = useSetAtom(routerAppNavigationAtom)
    const requestNavigation = useSetAtom(requestNavigationAtom)
    const activateEvaluatorEnrichment = useSetAtom(activateEvaluatorEnrichmentAtom)
    const {baseAppURL} = useURL()
    const [switcherOpen, setSwitcherOpen] = useState(false)

    // When the URL doesn't currently point at a workflow (e.g. user is on
    // /home but the section is shown because they recently visited one), fall
    // back to the persisted recent IDs so the card still shows something
    // meaningful instead of a placeholder.
    const fallbackWorkflow = useMemo<Workflow | null>(() => {
        if (ctx.workflow) return null
        // The fallback exists only for routes that point at NO workflow (e.g.
        // /home showing the recently-visited section). While the URL's own
        // workflow is still resolving (`isResolving`), do NOT substitute a stale
        // recent workflow: on an app route the recent entry is often a recent
        // EVALUATOR, and flashing its tag mounts `EvaluatorTag`, which fires
        // GET /evaluators/catalog/templates for a card that's about to swap to
        // the app's own type. Waiting one tick costs nothing and avoids the
        // wasted catalog fetch. Settled states (not-found, /home) keep the
        // recent-workflow fallback.
        if (ctx.isResolving) return null
        const fromEvaluators = recentEvaluatorId
            ? (evaluators.find((w) => w.id === recentEvaluatorId) ?? null)
            : null
        if (fromEvaluators) return fromEvaluators
        const fromApps = recentAppId ? (apps.find((w) => w.id === recentAppId) ?? null) : null
        return fromApps
    }, [ctx.workflow, ctx.isResolving, evaluators, apps, recentEvaluatorId, recentAppId])

    const workflow = ctx.workflow ?? fallbackWorkflow
    const isEvaluator = ctx.workflow
        ? ctx.workflowKind === "evaluator"
        : !!fallbackWorkflow?.flags?.is_evaluator
    const workflowId = workflow?.id ?? null

    // Latest revision query — used to derive the evaluator key (URI parsing)
    // and to read the resolved app type when the latest-revision derived atom
    // hasn't run yet. Cached + batched so calling it here is cheap.
    const latestRevision = useAtomValue(workflowLatestRevisionQueryAtomFamily(workflowId ?? ""))
    const appType = useAtomValue(workflowAppTypeAtomFamily(workflowId ?? "")) as WorkflowType | null
    const evaluatorKey = useMemo(() => {
        if (!isEvaluator) return null
        const uri = (latestRevision.data?.data as {uri?: string} | undefined)?.uri
        return parseWorkflowKeyFromUri(uri ?? null)
    }, [isEvaluator, latestRevision.data])

    const displayName = workflow?.name ?? workflow?.slug ?? workflowId ?? "Select workflow"

    const switcherItems = useMemo<MenuProps["items"]>(() => {
        const toMenuItem = (entity: Workflow, isEval: boolean) => {
            const label = entity.name ?? entity.slug ?? entity.id
            return {
                key: entity.id,
                label: <SwitcherRow workflowId={entity.id} label={label} isEvaluator={isEval} />,
            }
        }
        const items: MenuProps["items"] = []
        if (apps.length) {
            items.push({
                key: "apps-header",
                type: "group",
                label: "Apps",
                children: apps.map((w) => toMenuItem(w, false)),
            })
        }
        if (switcherEvaluators.length) {
            items.push({
                key: "evaluators-header",
                type: "group",
                label: "Evaluators",
                children: switcherEvaluators.map((w) => toMenuItem(w, true)),
            })
        }
        return items
    }, [apps, switcherEvaluators])

    const handleSwitcherClick = useCallback<NonNullable<MenuProps["onClick"]>>(
        ({key}) => {
            setSwitcherOpen(false)
            if (key && key !== workflowId) {
                navigateToWorkflow(key)
            }
        },
        [navigateToWorkflow, workflowId],
    )

    // Opening the switcher activates (a) the local latch — so the apps + evaluator
    // lists that populate the dropdown resolve now instead of on mount — and (b)
    // the shared evaluator-enrichment gate, so the batched latest-revision fetch
    // (type tags) happens on first open too. Both are one-way + cached, so
    // reopening is instant.
    const handleSwitcherOpenChange = useCallback(
        (open: boolean) => {
            setSwitcherOpen(open)
            if (open) {
                setSwitcherActivated(true)
                if (EVALUATOR_FULL_PAGE_NAV_ENABLED) activateEvaluatorEnrichment()
            }
        },
        [activateEvaluatorEnrichment],
    )

    const handleClose = useCallback(() => {
        // Exit the entity context — go back to the apps listing. We replace
        // (not push) so the back button doesn't bring the user straight back
        // into the workflow they just closed.
        if (!baseAppURL) return
        requestNavigation({type: "href", href: baseAppURL, method: "replace"})
    }, [baseAppURL, requestNavigation])

    const selectedKeys = workflowId ? [workflowId] : undefined

    if (collapsed) {
        return (
            <div className="flex justify-center w-full">
                <Dropdown
                    trigger={["click"]}
                    placement="bottomLeft"
                    destroyOnHidden
                    open={switcherOpen}
                    onOpenChange={handleSwitcherOpenChange}
                    styles={{root: {zIndex: 2000, minWidth: 280}}}
                    menu={{
                        items: switcherItems,
                        selectedKeys,
                        onClick: handleSwitcherClick,
                        className: SWITCHER_MENU_CLASS,
                    }}
                >
                    <Button
                        type="text"
                        className="!w-[28px] !h-[28px] !p-0 flex items-center justify-center"
                        icon={<ArrowsLeftRight size={14} />}
                    />
                </Dropdown>
            </div>
        )
    }

    return (
        <div
            className={clsx(
                "rounded-md border border-solid border-gray-200 bg-[var(--ag-c-FFFFFF)] px-2.5 py-2",
                "flex flex-col gap-1.5",
            )}
        >
            <div className="flex items-center gap-1 min-w-0">
                <span
                    className="truncate text-xs font-medium text-gray-900 flex-1 min-w-0"
                    title={displayName}
                >
                    {displayName}
                </span>
                <Tooltip title="Switch workflow" placement="top">
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        destroyOnHidden
                        open={switcherOpen}
                        onOpenChange={handleSwitcherOpenChange}
                        styles={{root: {zIndex: 2000, minWidth: 280}}}
                        menu={{
                            items: switcherItems,
                            selectedKeys,
                            onClick: handleSwitcherClick,
                            className: SWITCHER_MENU_CLASS,
                        }}
                    >
                        <Button
                            type="text"
                            size="small"
                            className="!px-1 !h-6 text-gray-500 hover:text-gray-900"
                            icon={<ArrowsLeftRight size={14} />}
                            aria-label="Switch workflow"
                        />
                    </Dropdown>
                </Tooltip>
                <Tooltip title="Close workflow" placement="top">
                    <Button
                        type="text"
                        size="small"
                        className="!px-1 !h-6 text-gray-500 hover:text-gray-900"
                        icon={<X size={14} />}
                        onClick={handleClose}
                        aria-label="Close workflow"
                    />
                </Tooltip>
            </div>
            <div>
                <WorkflowTypeTag
                    isEvaluator={isEvaluator}
                    workflowKey={evaluatorKey}
                    evaluatorTypeKey={appType}
                    workflowType={appType}
                />
            </div>
        </div>
    )
})

WorkflowEntityCard.displayName = "WorkflowEntityCard"

export default WorkflowEntityCard
