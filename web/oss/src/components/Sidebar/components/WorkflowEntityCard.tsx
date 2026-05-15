import {memo, useCallback, useMemo, useState} from "react"

import {
    fullPagePlaygroundEvaluatorsAtom,
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
import {currentWorkflowContextAtom, recentEvaluatorIdAtom} from "@/oss/state/workflow"

interface WorkflowEntityCardProps {
    collapsed: boolean
}

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
    "[&_.ant-dropdown-menu-item-group-title]:bg-white",
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
    // Full set of evaluators — used for resolving the *active* workflow (the
    // user may be inside a drawer-only evaluator currently). The switcher
    // dropdown below uses `fullPagePlaygroundEvaluators` instead so it only
    // lists evaluators whose destination is /apps/[id]/playground — clicking
    // a declarative classifier or human evaluator from the sidebar would
    // route through the route guard and bounce back to /evaluators, which is
    // confusing.
    const evaluators = useAtomValue(nonArchivedEvaluatorsAtom) as readonly Workflow[]
    const fullPagePlaygroundEvaluators = useAtomValue(
        fullPagePlaygroundEvaluatorsAtom,
    ) as readonly Workflow[]
    const recentAppId = useAtomValue(recentAppIdAtom)
    const recentEvaluatorId = useAtomValue(recentEvaluatorIdAtom)
    const navigateToWorkflow = useSetAtom(routerAppNavigationAtom)
    const requestNavigation = useSetAtom(requestNavigationAtom)
    const {baseAppURL} = useURL()
    const [switcherOpen, setSwitcherOpen] = useState(false)

    // When the URL doesn't currently point at a workflow (e.g. user is on
    // /home but the section is shown because they recently visited one), fall
    // back to the persisted recent IDs so the card still shows something
    // meaningful instead of a placeholder.
    const fallbackWorkflow = useMemo<Workflow | null>(() => {
        if (ctx.workflow) return null
        const fromEvaluators = recentEvaluatorId
            ? (evaluators.find((w) => w.id === recentEvaluatorId) ?? null)
            : null
        if (fromEvaluators) return fromEvaluators
        const fromApps = recentAppId ? (apps.find((w) => w.id === recentAppId) ?? null) : null
        return fromApps
    }, [ctx.workflow, evaluators, apps, recentEvaluatorId, recentAppId])

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
        if (fullPagePlaygroundEvaluators.length) {
            items.push({
                key: "evaluators-header",
                type: "group",
                label: "Evaluators",
                children: fullPagePlaygroundEvaluators.map((w) => toMenuItem(w, true)),
            })
        }
        return items
    }, [apps, fullPagePlaygroundEvaluators])

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
                    className="flex items-center justify-center w-full"
                    icon={<ArrowsLeftRight size={14} />}
                />
            </Dropdown>
        )
    }

    return (
        <div
            className={clsx(
                "rounded-md border border-solid border-gray-200 bg-white px-2.5 py-2",
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
                    workflowType={appType}
                />
            </div>
        </div>
    )
})

WorkflowEntityCard.displayName = "WorkflowEntityCard"

export default WorkflowEntityCard
