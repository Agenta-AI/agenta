import {useEffect, useMemo} from "react"

import {
    Buildings,
    ClockCounterClockwise,
    FolderSimple,
    Key,
    Lightning,
    Link,
    Plugs,
    Receipt,
    ShieldCheck,
    SlidersHorizontal,
    Sparkle,
    User,
    UsersThree,
    Vault,
    Wrench,
} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {
    getSettingsSidebarTabs,
    isSettingsTabKey,
    resolveSettingsTab,
    SETTINGS_SCOPES,
    type SettingsScopeKey,
    type SettingsTabKey,
} from "@/oss/components/pages/settings/assets/navigation"
import {useSettingsAccess} from "@/oss/components/pages/settings/hooks/useSettingsAccess"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {settingsTabAtom} from "@/oss/state/settings"

import ProjectOrgSwitcher from "../components/ProjectOrgSwitcher"
import SidebarBackButton from "../components/SidebarBackButton"
import SidebarToggleButton from "../components/SidebarToggleButton"
import type {
    SidebarConfig,
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "../engine/types"

import {useSidebarBottomSection} from "./bottomSection"
import {SETTINGS_SIDEBAR_SCOPE_ID} from "./constants"

interface SettingsScopeOptions {
    lastPath?: string
}

const getSettingsSidebarIcon = (key: SettingsTabKey) => {
    switch (key) {
        case "apiKeys":
            return <Key size={14} />
        case "secrets":
            return <Vault size={14} />
        case "llms":
            return <Sparkle size={14} />
        case "tools":
            return <Wrench size={14} />
        case "triggers":
            return <Lightning size={14} />
        case "webhooks":
            return <Link size={14} />
        case "mcpEndpoints":
            return <Plugs size={14} />
        case "workspace":
            return <UsersThree size={14} />
        case "organizationGeneral":
            return <Buildings size={14} />
        case "organization":
            return <ShieldCheck size={14} />
        case "auditLog":
            return <ClockCounterClockwise size={14} />
        case "billing":
            return <Receipt size={14} />
        case "account":
            return <User size={14} />
        case "preferences":
            return <SlidersHorizontal size={14} />
        case "projects":
            return <FolderSimple size={14} />
        default: {
            const exhaustiveCheck: never = key
            return exhaustiveCheck
        }
    }
}

const useSettingsTabs = (): Record<SettingsScopeKey, SidebarConfig[]> => {
    const access = useSettingsAccess()

    return useMemo<Record<SettingsScopeKey, SidebarConfig[]>>(() => {
        const items: Record<SettingsScopeKey, SidebarConfig[]> = {
            project: [],
            organization: [],
            personal: [],
        }

        getSettingsSidebarTabs(access).forEach(({key, scope, title, isHidden}) => {
            items[scope].push({
                key,
                title,
                icon: getSettingsSidebarIcon(key),
                isHidden,
            })
        })

        return items
    }, [access])
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
    const tabsByScope = useSettingsTabs()
    const bottomSection = useSidebarBottomSection({includeSettingsLink: false})

    return useMemo(
        () => [
            ...SETTINGS_SCOPES.map(({key, title}, index) => ({
                key: `settings-${key}`,
                items: tabsByScope[key],
                // Groups are separated by whitespace, not a rule.
                dividerBefore: false,
                before: ({collapsed}: SidebarSlotContext) =>
                    collapsed ? null : (
                        // pl-[22px] = menu items' mx-2 + pl-3 (20px), nudged 2px right.
                        <div
                            className={[
                                "pl-[22px] pr-3 pb-1 text-xs font-medium text-colorTextTertiary",
                                index === 0 ? "pt-1" : "pt-4",
                            ].join(" ")}
                        >
                            {title}
                        </div>
                    ),
            })),
            bottomSection,
        ],
        [bottomSection, tabsByScope],
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
