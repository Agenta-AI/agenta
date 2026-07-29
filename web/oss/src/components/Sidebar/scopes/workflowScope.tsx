import {useMemo} from "react"

import SidebarBackButton from "../components/SidebarBackButton"
import WorkflowPicker from "../components/WorkflowPicker"
import type {SidebarScope, SidebarSection, SidebarSlotContext} from "../engine/types"

import {useSidebarBottomSection} from "./bottomSection"
import {WORKFLOW_SIDEBAR_SCOPE_ID} from "./constants"
import {useWorkflowSidebarItems} from "./workflowItems"

interface WorkflowScopeOptions {
    lastPath?: string
}

// The two header rows are 45px tall so the rail's lines land on the same y as the
// breadcrumb bar's and the playground header's, and read as one line across the app.
const WorkflowSidebarHeader = ({collapsed, lastPath}: SidebarSlotContext) => (
    <>
        <div
            className={[
                "w-full h-[45px] shrink-0 flex items-center border-0 border-b border-solid border-[var(--ag-shell-line)]",
                collapsed ? "justify-center" : "px-1.5",
            ].join(" ")}
        >
            <SidebarBackButton collapsed={collapsed} lastPath={lastPath} />
        </div>

        <div
            className={[
                "flex h-[45px] shrink-0 items-center border-0 border-b border-solid border-[var(--ag-shell-line)]",
                collapsed ? "w-full justify-center" : "px-2",
            ].join(" ")}
        >
            <WorkflowPicker collapsed={collapsed} />
        </div>
    </>
)

const ROUTE_SELECTION = {mode: "route"} as const
const useWorkflowSidebarSelection = () => ROUTE_SELECTION

const useWorkflowSidebarSections = (): SidebarSection[] => {
    const items = useWorkflowSidebarItems()
    const bottomSection = useSidebarBottomSection()

    return useMemo(() => [{key: "workflow", items}, bottomSection], [bottomSection, items])
}

export const createWorkflowSidebarScope = ({lastPath}: WorkflowScopeOptions): SidebarScope => ({
    id: WORKFLOW_SIDEBAR_SCOPE_ID,
    lastPath,
    useSelection: useWorkflowSidebarSelection,
    useSections: useWorkflowSidebarSections,
    header: WorkflowSidebarHeader,
})
