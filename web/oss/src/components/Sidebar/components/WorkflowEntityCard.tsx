import {memo, useCallback, useMemo, useState} from "react"

import {
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
import {useAtomValue, useSetAtom} from "jotai"

import useURL from "@/oss/hooks/useURL"
import {recentAppIdAtom, routerAppNavigationAtom} from "@/oss/state/app/atoms/fetcher"
import {requestNavigationAtom} from "@/oss/state/appState"
import {
    currentWorkflowContextAtom,
    EVALUATOR_FULL_PAGE_NAV_ENABLED,
    recentEvaluatorIdAtom,
} from "@/oss/state/workflow"

import {resolveWorkflowEntitySelection} from "./assets/workflowEntitySelection"

interface WorkflowEntityCardProps {
    collapsed: boolean
}

const EMPTY_WORKFLOWS: readonly Workflow[] = []

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
    const apps = useAtomValue(nonArchivedAppWorkflowsAtom) as readonly Workflow[]
    const evaluators = useAtomValue(nonArchivedEvaluatorsAtom) as readonly Workflow[]
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
    const automaticEvaluators = useAtomValue(nonHumanEvaluatorsAtom) as readonly Workflow[]
    // Gated by `EVALUATOR_FULL_PAGE_NAV_ENABLED`: while the flag is off, the
    // switcher dropdown hides the "Evaluators" group entirely.
    const switcherEvaluators: readonly Workflow[] = useMemo(() => {
        if (!EVALUATOR_FULL_PAGE_NAV_ENABLED) return EMPTY_WORKFLOWS
        return automaticEvaluators
    }, [automaticEvaluators])
    const recentAppId = useAtomValue(recentAppIdAtom)
    const recentEvaluatorId = useAtomValue(recentEvaluatorIdAtom)
    const navigateToWorkflow = useSetAtom(routerAppNavigationAtom)
    const requestNavigation = useSetAtom(requestNavigationAtom)
    const {baseAppURL} = useURL()
    const [switcherOpen, setSwitcherOpen] = useState(false)

    // Route workflow wins. On project-level pages the app sidebar links are built
    // from recentAppId, so the card must prefer the same app over a stale recent
    // evaluator to avoid appearing to switch workflow context.
    const workflow = useMemo<Workflow | null>(
        () =>
            resolveWorkflowEntitySelection({
                currentWorkflow: ctx.workflow,
                currentWorkflowId: ctx.workflowId,
                apps,
                evaluators,
                recentAppId,
                recentEvaluatorId,
            }),
        [ctx.workflow, ctx.workflowId, apps, evaluators, recentAppId, recentEvaluatorId],
    )

    const workflowId = workflow?.id ?? null

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
                    onOpenChange={setSwitcherOpen}
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
                "rounded-lg border border-solid border-gray-200 bg-[var(--ag-c-FFFFFF)] px-2.5 py-1.5",
                "flex flex-col gap-1.5",
            )}
        >
            <div className="flex items-center gap-1 min-w-0">
                <span
                    className="truncate font-medium text-colorTextSecondary flex-1 min-w-0"
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
                        onOpenChange={setSwitcherOpen}
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
                            icon={<ArrowsLeftRight size={12} />}
                            aria-label="Switch workflow"
                        />
                    </Dropdown>
                </Tooltip>
                <Tooltip title="Close workflow" placement="top">
                    <Button
                        type="text"
                        size="small"
                        className="!px-1 !h-6 text-gray-500 hover:text-gray-900"
                        icon={<X size={12} />}
                        onClick={handleClose}
                        aria-label="Close workflow"
                    />
                </Tooltip>
            </div>
        </div>
    )
})

WorkflowEntityCard.displayName = "WorkflowEntityCard"

export default WorkflowEntityCard
