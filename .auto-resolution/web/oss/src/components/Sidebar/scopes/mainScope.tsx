import {useMemo} from "react"

import {Divider} from "antd"
import {useAtomValue} from "jotai"

import SidePanelSubscriptionInfo from "@/oss/components/SidePanel/Subscription"
import {homeNavHighlightedAtom} from "@/oss/state/onboarding"

import ListOfOrgs from "../components/ListOfOrgs"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "../engine/types"
import {useSidebarConfig} from "../hooks/useSidebarConfig"

import {useSidebarBottomSection} from "./bottomSection"
import {HOME_SIDEBAR_KEY, MAIN_SIDEBAR_SCOPE_ID} from "./constants"

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

// During onboarding the route is the ephemeral playground, but Home IS the surface — pin it selected.
const useMainSidebarSelection = (): SidebarSelection => {
    const highlightHome = useAtomValue(homeNavHighlightedAtom)
    return useMemo(
        () =>
            highlightHome
                ? {mode: "route", selectedKeyOverride: HOME_SIDEBAR_KEY}
                : {mode: "route"},
        [highlightHome],
    )
}

const useMainSidebarSections = (): SidebarSection[] => {
    const {projectItems} = useSidebarConfig()
    const bottomSection = useSidebarBottomSection()

    return useMemo(
        () => [
            {
                key: "project",
                items: projectItems,
            },
            bottomSection,
        ],
        [bottomSection, projectItems],
    )
}

export const mainSidebarScope: SidebarScope = {
    id: MAIN_SIDEBAR_SCOPE_ID,
    useSelection: useMainSidebarSelection,
    useSections: useMainSidebarSections,
    header: MainSidebarHeader,
    footer: MainSidebarFooter,
}
