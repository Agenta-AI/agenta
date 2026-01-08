import {FC, useMemo} from "react"

import {ApartmentOutlined} from "@ant-design/icons"
import {ArrowLeftIcon, SparkleIcon, ReceiptIcon, KeyIcon} from "@phosphor-icons/react"
import {Button, Divider} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"
import {isDemo} from "@/oss/lib/helpers/utils"

import ListOfOrgs from "./components/ListOfOrgs"
import SidebarMenu from "./components/SidebarMenu"
import {SidebarConfig} from "./types"

interface SettingsSidebarProps {
    lastPath?: string
}

const SettingsSidebar: FC<SettingsSidebarProps> = ({lastPath}) => {
    const router = useRouter()
    const [collapsed] = useAtom(sidebarCollapsedAtom)
    const [tab, setTab] = useQueryParam("tab", "workspace", "replace")

    const items = useMemo<SidebarConfig[]>(() => {
        const list: SidebarConfig[] = [
            {
                key: "workspace",
                title: "Workspace",
                icon: <ApartmentOutlined />,
            },
            {
                key: "secrets",
                title: "Model Hub",
                icon: <SparkleIcon size={16} className="mt-0.5" />,
            },
            {
                key: "apiKeys",
                title: "API Keys",
                icon: <KeyIcon size={16} />,
            },
        ]
        if (isDemo()) {
            list.push({
                key: "billing",
                title: "Usage & Billing",
                icon: <ReceiptIcon size={16} className="mt-0.5" />,
            })
        }
        return list
    }, [])

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
                    icon={<ArrowLeftIcon size={14} />}
                    onClick={() => {
                        if (lastPath) router.push(lastPath)
                        else router.back()
                    }}
                >
                    {!collapsed && "Back"}
                </Button>
            </div>

            <Divider className="mb-1 mt-0" />
            <div className="w-full flex flex-col gap-3">
                <ListOfOrgs collapsed={collapsed} buttonProps={{type: "text"}} />
                <SidebarMenu
                    items={items}
                    collapsed={collapsed}
                    menuProps={{
                        selectedKeys: [tab],
                        className:
                            "border-r-0 overflow-y-auto relative [&_.ant-menu-item-selected]:font-medium",
                        openKeys: [tab],
                        onClick: ({domEvent, key}) => {
                            domEvent.preventDefault()
                            if (key !== tab) {
                                setTab(key)
                            }
                        },
                    }}
                />
            </div>
        </section>
    )
}

export default SettingsSidebar
