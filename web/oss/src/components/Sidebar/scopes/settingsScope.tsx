import {useEffect, useMemo} from "react"

import {
    Buildings,
    ClockCounterClockwise,
    Flag,
    FolderSimple,
    Key,
    Lightning,
    Link,
    Receipt,
    ShieldCheck,
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
            return <Key size={16} className="mt-0.5" />
        case "secrets":
            return <Vault size={16} className="mt-0.5" />
        case "llms":
            return <Sparkle size={16} className="mt-0.5" />
        case "tools":
            return <Wrench size={16} className="mt-0.5" />
        case "triggers":
            return <Lightning size={16} className="mt-0.5" />
        case "webhooks":
            return <Link size={16} className="mt-0.5" />
        case "workspace":
            return <UsersThree size={16} className="mt-0.5" />
        case "organizationGeneral":
            return <Buildings size={16} className="mt-0.5" />
        case "organization":
            return <ShieldCheck size={16} className="mt-0.5" />
        case "auditLog":
            return <ClockCounterClockwise size={16} className="mt-0.5" />
        case "billing":
            return <Receipt size={16} className="mt-0.5" />
        case "account":
            return <User size={16} className="mt-0.5" />
        case "featureFlags":
            return <Flag size={16} className="mt-0.5" />
        case "projects":
            return <FolderSimple size={16} className="mt-0.5" />
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
                dividerBefore: index > 0,
                before: ({collapsed}: SidebarSlotContext) =>
                    collapsed ? null : (
                        <div className="px-3 pb-1 pt-1 text-xs font-medium text-colorTextTertiary">
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
            "w-full h-[48px] flex items-center border-0 border-b border-solid border-[var(--ag-shell-line)]",
            collapsed ? "justify-center" : "px-1.5",
        ].join(" ")}
    >
        <SidebarBackButton collapsed={collapsed} lastPath={lastPath} />
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
