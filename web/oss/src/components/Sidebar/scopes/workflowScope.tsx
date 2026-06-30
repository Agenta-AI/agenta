import {useMemo} from "react"

import {Divider} from "antd"

import SidebarBackButton from "../components/SidebarBackButton"
import WorkflowPicker from "../components/WorkflowPicker"
import type {SidebarScope, SidebarSection, SidebarSlotContext} from "../engine/types"

import {WORKFLOW_SIDEBAR_SCOPE_ID} from "./constants"
import {useWorkflowSidebarItems} from "./workflowItems"

interface WorkflowScopeOptions {
    lastPath?: string
}

const createWorkflowHeader = (lastPath?: string) => {
    const WorkflowSidebarHeader = ({collapsed}: SidebarSlotContext) => {
        return (
            <>
                <div
                    className={[
                        "w-full h-[48px] flex items-center",
                        collapsed ? "justify-center" : "mx-1.5",
                    ].join(" ")}
                >
                    <SidebarBackButton collapsed={collapsed} lastPath={lastPath} />
                </div>

                <div className={collapsed ? "flex w-full justify-center p-2" : "px-2 pt-1 pb-2"}>
                    <WorkflowPicker collapsed={collapsed} />
                </div>
                <Divider className="mb-1 mt-0" />
            </>
        )
    }

    return WorkflowSidebarHeader
}

const ROUTE_SELECTION = {mode: "route"} as const
const useWorkflowSidebarSelection = () => ROUTE_SELECTION

const useWorkflowSidebarSections = (): SidebarSection[] => {
    const items = useWorkflowSidebarItems()

    return useMemo(() => [{key: "workflow", items}], [items])
}

export const createWorkflowSidebarScope = ({lastPath}: WorkflowScopeOptions): SidebarScope => ({
    id: WORKFLOW_SIDEBAR_SCOPE_ID,
    useSelection: useWorkflowSidebarSelection,
    useSections: useWorkflowSidebarSections,
    header: createWorkflowHeader(lastPath),
})
