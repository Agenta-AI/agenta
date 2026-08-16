import type {WorkflowType} from "@agenta/entities/workflow"
import {workflowAppTypeAtomFamily} from "@agenta/entities/workflow"
import type {SidebarConfig, SidebarWorkflowCategory} from "@agenta/navigation"
import {atom, useAtomValue} from "jotai"

import {currentWorkflowContextAtom, type WorkflowKind} from "@/oss/state/workflow"

import {useSidebarConfig} from "../hooks/useSidebarConfig"

import {filterWorkflowSidebarItems} from "./workflowItemSupport"

export type WorkflowCategory = SidebarWorkflowCategory

export const deriveWorkflowCategory = (
    kind: WorkflowKind | null,
    appType: WorkflowType | null,
): WorkflowCategory => {
    if (kind === "evaluator") return "evaluator"
    if (appType === "agent") return "agent"
    return "app"
}

const currentWorkflowAppTypeAtom = atom((get) => {
    const {workflowId} = get(currentWorkflowContextAtom)
    return workflowId ? get(workflowAppTypeAtomFamily(workflowId)) : null
})

export const useWorkflowSidebarItems = (): SidebarConfig[] => {
    const {appItems} = useSidebarConfig()
    const {workflowKind} = useAtomValue(currentWorkflowContextAtom)
    const appType = useAtomValue(currentWorkflowAppTypeAtom)
    const category = deriveWorkflowCategory(workflowKind, appType)

    return filterWorkflowSidebarItems(appItems, category)
}
