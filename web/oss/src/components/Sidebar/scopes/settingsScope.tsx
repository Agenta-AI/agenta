import {useEffect, useMemo} from "react"

import {
    ArrowLeft,
    Buildings,
    ClockCounterClockwise,
    Key,
    Link,
    Receipt,
    Sparkle,
    User,
    UsersThree,
    Wrench,
} from "@phosphor-icons/react"
import {Button, Divider} from "antd"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

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

interface SettingsScopeOptions {
    lastPath?: string
}

const useSettingsAccess = () => {
    const {selectedOrg} = useOrgData()
    const {user} = useProfileData()
    const {canViewApiKeys, canViewEvents} = useProjectPermissions()
    const isOwner = !!selectedOrg?.owner_id && selectedOrg.owner_id === user?.id
    const canShowOrganization = isEE()
    const canShowUsageBilling = isEE() && isOwner
    const billingEnabled = isBillingEnabled()
    const canShowTools = isToolsEnabled()
    const canShowAuditLog = isEE() && canViewEvents
    const canShowAccount = isEE()

    return {
        billingEnabled,
        canShowAccount,
        canShowAuditLog,
        canShowOrganization,
        canShowTools,
        canShowUsageBilling,
        canViewApiKeys,
        isOwner,
    }
}

const DEFAULT_SETTINGS_TAB = "workspace"

// Single source of truth for the settings tabs: key, label, and visibility. Both the
// rendered menu and the selection guard read from here, so an item's `isHidden` flag is
// the only place access rules live — rendering and selection can never drift.
const useSettingsTabs = (): SidebarConfig[] => {
    const {
        billingEnabled,
        canShowAccount,
        canShowAuditLog,
        canShowOrganization,
        canShowTools,
        canShowUsageBilling,
        canViewApiKeys,
        isOwner,
    } = useSettingsAccess()

    return useMemo<SidebarConfig[]>(
        () => [
            {
                key: "apiKeys",
                title: "API Keys",
                icon: <Key size={16} className="mt-0.5" />,
                isHidden: !canViewApiKeys,
            },
            {
                key: "secrets",
                title: "Providers & Models",
                icon: <Sparkle size={16} className="mt-0.5" />,
            },
            {
                key: "tools",
                title: "Tools",
                icon: <Wrench size={16} className="mt-0.5" />,
                isHidden: !canShowTools,
            },
            {
                key: "automations",
                title: "Automations",
                icon: <Link size={16} className="mt-0.5" />,
                divider: true,
            },
            {
                key: "workspace",
                title: "Members",
                icon: <UsersThree size={16} className="mt-0.5" />,
            },
            {
                key: "organization",
                title: "Access & Security",
                icon: <Buildings size={16} className="mt-0.5" />,
                isHidden: !(isOwner && canShowOrganization),
            },
            {
                key: "auditLog",
                title: "Audit Log",
                icon: <ClockCounterClockwise size={16} className="mt-0.5" />,
                isHidden: !canShowAuditLog,
            },
            {
                key: "billing",
                title: billingEnabled ? "Usage & Billing" : "Usage",
                icon: <Receipt size={16} className="mt-0.5" />,
                isHidden: !canShowUsageBilling,
            },
            {
                key: "account",
                title: "Account",
                icon: <User size={16} className="mt-0.5" />,
                divider: true,
                isHidden: !canShowAccount,
            },
        ],
        [
            canShowUsageBilling,
            billingEnabled,
            canShowOrganization,
            canShowTools,
            canViewApiKeys,
            canShowAuditLog,
            canShowAccount,
            isOwner,
        ],
    )
}

const useSettingsSidebarSelection = (): SidebarSelection => {
    const [tab, setTab] = useQueryParam("tab", undefined, "replace")
    const [settingsTab, setSettingsTab] = useAtom(settingsTabAtom)
    const tabs = useSettingsTabs()

    // Unknown tabs and tabs the user can't see both fall back to the default.
    const visibleKeys = useMemo(
        () => new Set(tabs.filter((item) => !item.isHidden).map((item) => item.key)),
        [tabs],
    )
    const requestedTab = tab ?? settingsTab ?? DEFAULT_SETTINGS_TAB
    const activeTab = visibleKeys.has(requestedTab) ? requestedTab : DEFAULT_SETTINGS_TAB

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
                        className="gap-2 flex items-center justify-center"
                        type="text"
                        icon={<ArrowLeft size={14} />}
                        onClick={() => {
                            if (lastPath) router.push(lastPath)
                            else router.back()
                        }}
                    >
                        {!collapsed && "Back"}
                    </Button>
                </div>

                <Divider className="mb-1 mt-0" />
                <ListOfOrgs collapsed={collapsed} buttonProps={{type: "text"}} />
                <Divider className="-mt-[3.5px] mb-3" />
            </>
        )
    }

    return SettingsSidebarHeader
}

export const createSettingsSidebarScope = ({lastPath}: SettingsScopeOptions): SidebarScope => ({
    id: "settings",
    useSelection: useSettingsSidebarSelection,
    useSections: useSettingsSidebarSections,
    header: createSettingsHeader(lastPath),
})
