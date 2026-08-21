import {useEffect, useMemo} from "react"

import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SETTINGS_SIDEBAR_SCOPE_ID} from "@agenta/navigation"
import {
    buildSettingsSidebarSections,
    getSettingsSidebarTabs,
    isSettingsTabKey,
    resolveSettingsTab,
} from "@agenta/settings"
import {useAtom} from "jotai"

import {useSettingsAccess} from "@/oss/components/pages/settings/hooks/useSettingsAccess"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {settingsTabAtom} from "@/oss/state/settings"

import ProjectOrgSwitcher from "../components/ProjectOrgSwitcher"
import SidebarBackButton from "../components/SidebarBackButton"
import SidebarToggleButton from "../components/SidebarToggleButton"

import {useSidebarBottomSection} from "./bottomSection"

interface SettingsScopeOptions {
    lastPath?: string
}

const useSettingsSidebarSelection = (): SidebarSelection => {
    const [tab, setTab] = useQueryParam("tab", undefined, "replace")
    const [settingsTab, setSettingsTab] = useAtom(settingsTabAtom)
    const access = useSettingsAccess()

    const requestedTab = tab ?? settingsTab
    const activeTab = resolveSettingsTab(requestedTab, access)

    useEffect(() => {
        if (settingsTab !== activeTab) {
            setSettingsTab(activeTab)
        }
        if (tab && tab !== activeTab) {
            setTab(activeTab)
        }
    }, [activeTab, settingsTab, setSettingsTab, setTab, tab])

    return {
        mode: "controlled",
        selectedKey: activeTab,
        onSelect: (key) => {
            if (!isSettingsTabKey(key)) return
            setSettingsTab(key)
            setTab(key)
        },
    }
}

const useSettingsSidebarSections = (): SidebarSection[] => {
    const access = useSettingsAccess()
    const bottomSection = useSidebarBottomSection({includeSettingsLink: false})

    return useMemo(
        () => [...buildSettingsSidebarSections(getSettingsSidebarTabs(access)), bottomSection],
        [access, bottomSection],
    )
}

const SettingsSidebarHeader = ({collapsed, lastPath}: SidebarSlotContext) => (
    <div
        className={[
            "w-full shrink-0 flex items-center mb-1",
            // Collapsed rail is 48px wide, too narrow for the Back button and the toggle side
            // by side, so stack them instead of squeezing both into one row.
            collapsed ? "flex-col justify-center gap-1 py-1" : "h-[48px] justify-between px-1.5",
        ].join(" ")}
    >
        <SidebarBackButton collapsed={collapsed} lastPath={lastPath} />
        <SidebarToggleButton />
    </div>
)

const SettingsSidebarAfterBottom = ({collapsed}: SidebarSlotContext) => (
    <ProjectOrgSwitcher collapsed={collapsed} />
)

export const createSettingsSidebarScope = ({lastPath}: SettingsScopeOptions): SidebarScope => ({
    id: SETTINGS_SIDEBAR_SCOPE_ID,
    lastPath,
    useSelection: useSettingsSidebarSelection,
    useSections: useSettingsSidebarSections,
    header: SettingsSidebarHeader,
    afterBottom: SettingsSidebarAfterBottom,
})
