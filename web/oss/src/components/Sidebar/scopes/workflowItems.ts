import type {WorkflowType} from "@agenta/entities/workflow"
import {workflowAppTypeAtomFamily} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import {currentWorkflowContextAtom, type WorkflowKind} from "@/oss/state/workflow"

import type {SidebarConfig} from "../engine/types"
import {useSidebarConfig} from "../hooks/useSidebarConfig"

export type WorkflowCategory = "app" | "agent" | "evaluator"

export const deriveWorkflowCategory = (
    kind: WorkflowKind | null,
    appType: WorkflowType | null,
): WorkflowCategory => {
    if (kind === "evaluator") return "evaluator"
    if (appType === "agent") return "agent"
    return "app"
}

export const ITEM_WORKFLOW_SUPPORT: Record<string, ReadonlySet<WorkflowCategory>> = {
    "app-variants-link": new Set(["app", "agent"]),
}

const currentWorkflowAppTypeAtom = atom((get) => {
    const {workflowId} = get(currentWorkflowContextAtom)
    return workflowId ? get(workflowAppTypeAtomFamily(workflowId)) : null
})

export const filterWorkflowSidebarItems = (
    items: SidebarConfig[],
    category: WorkflowCategory,
): SidebarConfig[] => items.filter((item) => ITEM_WORKFLOW_SUPPORT[item.key]?.has(category) ?? true)

export const useWorkflowSidebarItems = (): SidebarConfig[] => {
    const {appItems} = useSidebarConfig()
    const {workflowKind} = useAtomValue(currentWorkflowContextAtom)
    const appType = useAtomValue(currentWorkflowAppTypeAtom)
    const category = deriveWorkflowCategory(workflowKind, appType)

    return filterWorkflowSidebarItems(appItems, category)
}
