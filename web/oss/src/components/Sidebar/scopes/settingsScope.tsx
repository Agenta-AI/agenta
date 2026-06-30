import {useEffect, useMemo} from "react"

import {
    ArrowLeft,
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
import {Button, Divider} from "antd"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {
    getSettingsSidebarTabs,
    resolveSettingsTab,
    type SettingsAccess,
    type SettingsTabKey,
} from "@/oss/components/pages/settings/assets/navigation"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {isBillingEnabled, isEE, isToolsEnabled} from "@/oss/lib/helpers/isEE"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {settingsTabAtom} from "@/oss/state/settings"

import ListOfOrgs from "../components/ListOfOrgs"
import type {
    SidebarConfig,
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "../engine/types"

import {SETTINGS_SIDEBAR_SCOPE_ID} from "./constants"

interface SettingsScopeOptions {
    lastPath?: string
}

const useSettingsAccess = (): SettingsAccess => {
    const {selectedOrg} = useOrgData()
    const {user} = useProfileData()
    const {canViewApiKeys, canViewEvents} = useProjectPermissions()
    const isOwner = !!selectedOrg?.owner_id && selectedOrg.owner_id === user?.id
    const billingEnabled = isBillingEnabled()

    return useMemo(
        () => ({
            billingEnabled,
            canShowTools: isToolsEnabled(),
            canShowTriggers: isToolsEnabled(),
            canViewApiKeys,
            canViewEvents,
            isEE: isEE(),
            isOwner,
        }),
        [billingEnabled, canViewApiKeys, canViewEvents, isOwner],
    )
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
            setSettingsTab(key)
            setTab(key)
        },
    }
}

const useSettingsSidebarSections = (): SidebarSection[] => {
    const items = useSettingsTabs()

    return useMemo(() => [{key: "settings", items}], [items])
}

const createSettingsHeader = (lastPath?: string) => {
    const SettingsSidebarHeader = ({collapsed}: SidebarSlotContext) => {
        const router = useRouter()

        return (
            <>
                <div
                    className={[
                        "w-full h-[44px] flex items-center",
                        collapsed ? "justify-center" : "mx-1.5",
                    ].join(" ")}
                >
                    <Button
                        aria-label="Back"
                        className="gap-2 flex items-center justify-center ml-2 mt-2"
                        type="text"
                        size="small"
                        icon={<ArrowLeft size={14} />}
                        onClick={() => {
                            if (lastPath) router.push(lastPath)
                            else router.back()
                        }}
                    >
                        {!collapsed && "Back"}
                    </Button>
                </div>

                <ListOfOrgs collapsed={collapsed} buttonProps={{type: "text"}} />
                <Divider className="-mt-[3.5px] mb-3" />
            </>
        )
    }

    return SettingsSidebarHeader
}

export const createSettingsSidebarScope = ({lastPath}: SettingsScopeOptions): SidebarScope => ({
    id: SETTINGS_SIDEBAR_SCOPE_ID,
    useSelection: useSettingsSidebarSelection,
    useSections: useSettingsSidebarSections,
    header: createSettingsHeader(lastPath),
})
