import {useEffect, useMemo} from "react"

import {
    Buildings,
    ClockCounterClockwise,
    Key,
    Lightning,
    Link,
    Receipt,
    Sparkle,
    User,
    UsersThree,
    Vault,
    Wrench,
} from "@phosphor-icons/react"
import {Divider} from "antd"
import {useAtom} from "jotai"

import {
    getSettingsSidebarTabs,
    isSettingsTabKey,
    resolveSettingsTab,
    type SettingsTabKey,
} from "@/oss/components/pages/settings/assets/navigation"
import {useSettingsAccess} from "@/oss/components/pages/settings/hooks/useSettingsAccess"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {settingsTabAtom} from "@/oss/state/settings"

import ListOfOrgs from "../components/ListOfOrgs"
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

const SETTINGS_TAB_DIVIDERS = new Set<SettingsTabKey>(["webhooks", "account"])

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
        case "organization":
            return <Buildings size={16} className="mt-0.5" />
        case "auditLog":
            return <ClockCounterClockwise size={16} className="mt-0.5" />
        case "billing":
            return <Receipt size={16} className="mt-0.5" />
        case "account":
            return <User size={16} className="mt-0.5" />
        case "projects":
            return <Buildings size={16} className="mt-0.5" />
        default: {
            const exhaustiveCheck: never = key
            return exhaustiveCheck
        }
    }
}

const useSettingsTabs = (): SidebarConfig[] => {
    const access = useSettingsAccess()

    return useMemo<SidebarConfig[]>(
        () =>
            getSettingsSidebarTabs(access).map(({key, title, isHidden}) => ({
                key,
                title,
                icon: getSettingsSidebarIcon(key),
                divider: SETTINGS_TAB_DIVIDERS.has(key),
                isHidden,
            })),
        [access],
    )
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
    const items = useSettingsTabs()
    const bottomSection = useSidebarBottomSection({includeSettingsLink: false})

    return useMemo(() => [{key: "settings", items}, bottomSection], [bottomSection, items])
}

const SettingsSidebarHeader = ({collapsed, lastPath}: SidebarSlotContext) => (
    <>
        <div
            className={[
                "w-full h-[44px] flex items-center",
                collapsed ? "justify-center" : "mx-1.5",
            ].join(" ")}
        >
            <SidebarBackButton collapsed={collapsed} lastPath={lastPath} className="mt-2" />
        </div>

        <ListOfOrgs collapsed={collapsed} buttonProps={{type: "text"}} />
        <Divider className="-mt-[3.5px] mb-3" />
    </>
)

export const createSettingsSidebarScope = ({lastPath}: SettingsScopeOptions): SidebarScope => ({
    id: SETTINGS_SIDEBAR_SCOPE_ID,
    lastPath,
    useSelection: useSettingsSidebarSelection,
    useSections: useSettingsSidebarSections,
    header: SettingsSidebarHeader,
})
