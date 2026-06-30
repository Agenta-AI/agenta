import {useMemo} from "react"

import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Divider} from "antd"
import {useRouter} from "next/router"

import WorkflowPicker from "../components/WorkflowPicker"
import type {SidebarScope, SidebarSection, SidebarSlotContext} from "../engine/types"

import {WORKFLOW_SIDEBAR_SCOPE_ID} from "./constants"
import {useWorkflowSidebarItems} from "./workflowItems"

interface WorkflowScopeOptions {
    lastPath?: string
}

const createWorkflowHeader = (lastPath?: string) => {
    const WorkflowSidebarHeader = ({collapsed}: SidebarSlotContext) => {
        const router = useRouter()

        return (
            <>
                <div
                    className={[
                        "w-full h-[44px] flex items-center",
                        collapsed ? "justify-center" : "mx-1.5",
                    ].join(" ")}
                >
                    <Button
                        aria-label="Back"
                        className="gap-2 flex items-center justify-center ml-2"
                        type="text"
                        size="small"
                        icon={<ArrowLeft size={14} />}
                        onClick={() => {
                            if (lastPath) router.push(lastPath)
                            else router.back()
                        }}
                    >
                        {!collapsed && "Back"}
                    </Button>
                </div>

                <div className="px-2 pt-1 pb-2">
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
