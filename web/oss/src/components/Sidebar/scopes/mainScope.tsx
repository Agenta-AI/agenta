import {useMemo} from "react"

import {useAtomValue} from "jotai"

import SidePanelSubscriptionInfo from "@/oss/components/SidePanel/Subscription"
import {homeNavHighlightedAtom} from "@/oss/state/onboarding"

import ProjectOrgSwitcher from "../components/ProjectOrgSwitcher"
import SidebarLogo from "../components/SidebarLogo"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "../engine/types"
import {useSidebarConfig} from "../hooks/useSidebarConfig"

import {useSidebarBottomSection} from "./bottomSection"
import {HOME_SIDEBAR_KEY, MAIN_SIDEBAR_SCOPE_ID} from "./constants"
import {useWorkflowSidebarSection} from "./workflowSection"

const MainSidebarHeader = ({collapsed}: SidebarSlotContext) => <SidebarLogo collapsed={collapsed} />

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
    const workflowSection = useWorkflowSidebarSection()
    const bottomSection = useSidebarBottomSection()

    return useMemo(
        () => [
            {
                key: "project",
                items: projectItems,
            },
            ...(workflowSection ? [workflowSection] : []),
            bottomSection,
        ],
        [bottomSection, projectItems, workflowSection],
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
