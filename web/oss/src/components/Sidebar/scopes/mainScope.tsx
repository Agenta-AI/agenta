import {useMemo} from "react"

import {Divider} from "antd"

import SidePanelSubscriptionInfo from "@/oss/components/SidePanel/Subscription"

import ListOfOrgs from "../components/ListOfOrgs"
import WorkflowEntityCard from "../components/WorkflowEntityCard"
import type {SidebarConfig, SidebarScope, SidebarSection, SidebarSlotContext} from "../engine/types"
import {useSidebarConfig} from "../hooks/useSidebarConfig"

const MainSidebarHeader = ({collapsed}: SidebarSlotContext) => (
    <>
        <ListOfOrgs collapsed={collapsed} />
        <Divider className="-mt-[3.5px] mb-1" />
    </>
)

const WorkflowEntitySectionBefore = ({collapsed}: SidebarSlotContext) => (
    <div className="px-2 pt-1 pb-2">
        <WorkflowEntityCard collapsed={collapsed} />
    </div>
)

const MainSidebarFooter = ({collapsed}: SidebarSlotContext) =>
    collapsed ? null : (
        <div className="mx-auto">
            <SidePanelSubscriptionInfo />
        </div>
    )

const ROUTE_SELECTION = {mode: "route"} as const
const useMainSidebarSelection = () => ROUTE_SELECTION

const useMainSidebarSections = (): SidebarSection[] => {
    const menu = useSidebarConfig()

    return useMemo(() => {
        const projectItems: SidebarConfig[] = []
        const appItems: SidebarConfig[] = []
        const bottomItems: SidebarConfig[] = []

        menu.forEach((item) => {
            if (item.isHidden) return
            if (item.isBottom) {
                bottomItems.push(item)
            } else if (item.isAppSection) {
                appItems.push(item)
            } else {
                projectItems.push(item)
            }
        })

        return [
            {
                key: "project",
                items: projectItems,
            },
            {
                key: "app",
                items: appItems,
                before: WorkflowEntitySectionBefore,
                dividerBefore: true,
            },
            {
                key: "bottom",
                items: bottomItems,
                placement: "bottom",
                mode: "vertical",
            },
        ]
    }, [menu])
}

export const mainSidebarScope: SidebarScope = {
    id: "main",
    useSelection: useMainSidebarSelection,
    useSections: useMainSidebarSections,
    header: MainSidebarHeader,
    footer: MainSidebarFooter,
}
