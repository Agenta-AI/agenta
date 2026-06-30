import {useMemo} from "react"

import {Divider} from "antd"

import SidePanelSubscriptionInfo from "@/oss/components/SidePanel/Subscription"

import ListOfOrgs from "../components/ListOfOrgs"
import type {SidebarScope, SidebarSection, SidebarSlotContext} from "../engine/types"
import {useSidebarConfig} from "../hooks/useSidebarConfig"

import {MAIN_SIDEBAR_SCOPE_ID} from "./constants"

const MainSidebarHeader = ({collapsed}: SidebarSlotContext) => (
    <>
        <ListOfOrgs collapsed={collapsed} />
        <Divider className="-mt-[3.5px] mb-1" />
    </>
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
    const {projectItems, bottomItems} = useSidebarConfig()

    return useMemo(
        () => [
            {
                key: "project",
                items: projectItems,
            },
            {
                key: "bottom",
                items: bottomItems,
                placement: "bottom",
                mode: "vertical",
            },
        ],
        [bottomItems, projectItems],
    )
}

export const mainSidebarScope: SidebarScope = {
    id: MAIN_SIDEBAR_SCOPE_ID,
    useSelection: useMainSidebarSelection,
    useSections: useMainSidebarSections,
    header: MainSidebarHeader,
    footer: MainSidebarFooter,
}
