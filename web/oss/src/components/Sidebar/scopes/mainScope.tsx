import {useMemo} from "react"

import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {HOME_SIDEBAR_KEY, MAIN_SIDEBAR_SCOPE_ID, SESSIONS_SIDEBAR_KEY} from "@agenta/navigation"
import {SidebarLogo} from "@agenta/navigation-ui"
import {useAtomValue} from "jotai"

import SidePanelSubscriptionInfo from "@/oss/components/SidePanel/Subscription"
import {homeNavHighlightedAtom} from "@/oss/state/onboarding"

import ProjectOrgSwitcher from "../components/ProjectOrgSwitcher"
import SidebarToggleButton from "../components/SidebarToggleButton"
import {activePlaygroundSessionIdAtom} from "../dynamic/localSessionRefs"
import {useSidebarConfig} from "../hooks/useSidebarConfig"

import {useSidebarBottomSection} from "./bottomSection"

const MainSidebarHeader = ({collapsed}: SidebarSlotContext) => (
    <SidebarLogo collapsed={collapsed} toggle={<SidebarToggleButton />} />
)

const MainSidebarFooter = ({collapsed}: SidebarSlotContext) =>
    collapsed ? null : (
        <div className="w-full">
            <SidePanelSubscriptionInfo />
        </div>
    )

const MainSidebarAfterBottom = ({collapsed}: SidebarSlotContext) => (
    <ProjectOrgSwitcher collapsed={collapsed} />
)

// During onboarding the route is the ephemeral playground, but Home IS the surface — pin it selected.
const useMainSidebarSelection = (): SidebarSelection => {
    const highlightHome = useAtomValue(homeNavHighlightedAtom)
    // A session row links to its AGENT's playground, so the route cannot tell the two apart and
    // the agent row won every tie. Pin the open session instead; the shell falls back to the
    // route match when that row is filtered out of the rail.
    const activeSessionId = useAtomValue(activePlaygroundSessionIdAtom)
    return useMemo(() => {
        if (highlightHome) return {mode: "route", selectedKeyOverride: HOME_SIDEBAR_KEY}
        if (activeSessionId) {
            return {
                mode: "route",
                selectedKeyOverride: `${SESSIONS_SIDEBAR_KEY}-${activeSessionId}`,
            }
        }
        return {mode: "route"}
    }, [activeSessionId, highlightHome])
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
