import {useMemo} from "react"

import {Divider} from "antd"
import {useAtomValue} from "jotai"

import {routeLayerAtom} from "@/oss/state/appState"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

import SidebarRowSkeleton from "../engine/SidebarRowSkeleton"
import type {SidebarSection, SidebarSlotContext} from "../engine/types"

import {
    currentWorkflowAppTypeAtom,
    deriveWorkflowCategory,
    useWorkflowSidebarItems,
} from "./workflowItems"

// Static (non-navigating) workflow name heading the section's items sit under.
const WorkflowSectionLabel = ({collapsed}: SidebarSlotContext) => {
    const {workflow, workflowId, isResolving} = useAtomValue(currentWorkflowContextAtom)

    if (collapsed) return <Divider className="my-1" />

    const resolvedName = workflow?.name ?? workflow?.slug

    // Skeleton until name/slug arrive \u2014 the id-only fallback would flash a raw hex id.
    if (isResolving && !resolvedName) {
        return (
            <div className="pl-[22px] pr-3 pb-1 pt-4 leading-none">
                <SidebarRowSkeleton />
            </div>
        )
    }

    const displayName = resolvedName ?? workflowId ?? ""

    return (
        <div
            // pl-[22px] = menu items' mx-2 + pl-3 (20px), nudged 2px right.
            className="pl-[22px] pr-3 pb-1 pt-4 text-xs font-medium text-colorTextTertiary truncate"
            title={displayName}
        >
            {displayName}
        </div>
    )
}

/**
 * The workflow section shown inside the main sidebar while on a non-agent
 * workflow route: a static name label followed by the category-filtered items.
 * Agents navigate through their own pages, so they get no section.
 */
export const useWorkflowSidebarSection = (): SidebarSection | null => {
    const routeLayer = useAtomValue(routeLayerAtom)
    const {workflowKind} = useAtomValue(currentWorkflowContextAtom)
    const appType = useAtomValue(currentWorkflowAppTypeAtom)
    const items = useWorkflowSidebarItems()

    // Explicit route gate — don't rely on items happening to self-hide off app routes.
    const isWorkflowRoute = routeLayer === "app"
    // Hidden until the kind resolves, so an agent route never flashes the section.
    const categoryResolved = workflowKind !== null || appType === "agent"
    const isAgent = deriveWorkflowCategory(workflowKind, appType) === "agent"

    const showSection = isWorkflowRoute && categoryResolved && !isAgent

    return useMemo(
        () => (showSection ? {key: "workflow", items, before: WorkflowSectionLabel} : null),
        [showSection, items],
    )
}
