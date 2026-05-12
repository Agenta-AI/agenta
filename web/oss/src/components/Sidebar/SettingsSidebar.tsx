import {FC, useEffect, useMemo} from "react"

import {
    ArrowLeft,
    Buildings,
    Key,
    Link,
    Receipt,
    Sparkle,
    UsersThree,
    Wrench,
} from "@phosphor-icons/react"
import {Button, Divider} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"
import {isBillingEnabled, isEE, isToolsEnabled} from "@/oss/lib/helpers/isEE"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {settingsTabAtom} from "@/oss/state/settings"

import ListOfOrgs from "./components/ListOfOrgs"
import SidebarMenu from "./components/SidebarMenu"
import {SidebarConfig} from "./types"

interface SettingsSidebarProps {
    lastPath?: string
}

const SettingsSidebar: FC<SettingsSidebarProps> = ({lastPath}) => {
    const router = useRouter()
    const [collapsed] = useAtom(sidebarCollapsedAtom)
    const [tab, setTab] = useQueryParam("tab", undefined, "replace")
    const [settingsTab, setSettingsTab] = useAtom(settingsTabAtom)
    const {selectedOrg} = useOrgData()
    const {user} = useProfileData()
    const {canViewApiKeys} = useProjectPermissions()
    const isOwner = !!selectedOrg?.owner_id && selectedOrg.owner_id === user?.id
    const canShowOrganization = isEE()
    const canShowBilling = isEE() && isBillingEnabled() && isOwner
    const canShowTools = isToolsEnabled()
    const activeTab = useMemo(() => {
        const requestedTab = tab ?? settingsTab ?? "workspace"

        if (
            (requestedTab === "organization" && !canShowOrganization) ||
            (requestedTab === "billing" && !canShowBilling) ||
            (requestedTab === "tools" && !canShowTools) ||
            (requestedTab === "apiKeys" && !canViewApiKeys)
        ) {
            return "workspace"
        }

        return requestedTab
    }, [canShowBilling, canShowOrganization, canShowTools, canViewApiKeys, settingsTab, tab])

    useEffect(() => {
        if (tab && tab !== settingsTab) {
            setSettingsTab(tab)
        }
    }, [tab, settingsTab, setSettingsTab])

    const items = useMemo<SidebarConfig[]>(() => {
        const list: SidebarConfig[] = [
            ...(canViewApiKeys
                ? [
                      {
                          key: "apiKeys",
                          title: "API Keys",
                          icon: <Key size={16} className="mt-0.5" />,
                      },
                  ]
                : []),
            {
                key: "secrets",
                title: "Models",
                icon: <Sparkle size={16} className="mt-0.5" />,
            },
            ...(canShowTools
                ? [
                      {
                          key: "tools",
                          title: "Tools",
                          icon: <Wrench size={16} className="mt-0.5" />,
                      },
                  ]
                : []),
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
            ...(isOwner && canShowOrganization
                ? [
                      {
                          key: "organization",
                          title: "Access & Security",
                          icon: <Buildings size={16} className="mt-0.5" />,
                      },
                  ]
                : []),
        ]
        if (canShowBilling) {
            list.push({
                key: "billing",
                title: "Usage & Billing",
                icon: <Receipt size={16} className="mt-0.5" />,
            })
        }
        return list
    }, [canShowBilling, canShowOrganization, canShowTools, canViewApiKeys, isOwner])

    return (
        <section
            className={clsx([
                "flex flex-col h-full",
                {"w-[80px] items-center": collapsed},
                {"w-[236px]": !collapsed},
            ])}
        >
            <div
                className={clsx(
                    "w-full h-[44px] flex items-center",
                    {"justify-center": collapsed},
                    {"mx-1.5": !collapsed},
                )}
            >
                <Button
                    className={"gap-2 flex items-center justify-center"}
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
            <SidebarMenu
                items={items}
                collapsed={collapsed}
                menuProps={{
                    selectedKeys: [activeTab],
                    className:
                        "border-r-0 overflow-y-auto relative [&_.ant-menu-item-selected]:font-medium",
                    openKeys: [activeTab],
                    onClick: ({domEvent, key}) => {
                        domEvent.preventDefault()
                        if (key !== activeTab) {
                            setSettingsTab(key)
                            setTab(key)
                        }
                    },
                }}
            />
        </section>
    )
}

export default SettingsSidebar
