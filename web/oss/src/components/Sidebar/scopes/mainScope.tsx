import {useMemo} from "react"

import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {HOME_SIDEBAR_KEY, MAIN_SIDEBAR_SCOPE_ID} from "@agenta/navigation"
import {SidebarLogo} from "@agenta/navigation-ui"
import {useAtomValue} from "jotai"

import SidePanelSubscriptionInfo from "@/oss/components/SidePanel/Subscription"
import {homeNavHighlightedAtom} from "@/oss/state/onboarding"

import ProjectOrgSwitcher from "../components/ProjectOrgSwitcher"
import SidebarToggleButton from "../components/SidebarToggleButton"
import {useSidebarConfig} from "../hooks/useSidebarConfig"

import {useSidebarBottomSection} from "./bottomSection"

const MainSidebarHeader = ({collapsed}: SidebarSlotContext) => (
    <SidebarLogo collapsed={collapsed} toggle={<SidebarToggleButton />} />
)

const MainSidebarFooter = ({collapsed}: SidebarSlotContext) =>
    collapsed ? null : (
        <div className="mx-auto">
            <SidePanelSubscriptionInfo />
        </div>
    )

const MainSidebarAfterBottom = ({collapsed}: SidebarSlotContext) => (
    <ProjectOrgSwitcher collapsed={collapsed} />
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
    afterBottom: MainSidebarAfterBottom,
}
