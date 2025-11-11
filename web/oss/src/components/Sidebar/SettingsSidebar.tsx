import {FC, useMemo} from "react"

import {ApartmentOutlined, KeyOutlined} from "@ant-design/icons"
import {ArrowLeft, Sparkle, Receipt} from "@phosphor-icons/react"
import {Button, Divider} from "antd"
import {useRouter} from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {isDemo} from "@/oss/lib/helpers/utils"

import {useStyles as useSidebarStyles} from "./assets/styles"
import SidebarMenu from "./components/SidebarMenu"
import {SidebarConfig} from "./types"

interface SettingsSidebarProps {
    lastPath?: string
}

const SettingsSidebar: FC<SettingsSidebarProps> = ({lastPath}) => {
    const sidebarClasses = useSidebarStyles()
    const router = useRouter()
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
                icon: <Sparkle size={16} className="mt-0.5" />,
            },
            {
                key: "apiKeys",
                title: "API Keys",
                icon: <KeyOutlined />,
            },
        ]
        if (isDemo()) {
            list.push({
                key: "billing",
                title: "Usage & Billing",
                icon: <Receipt size={16} className="mt-0.5" />,
            })
        }
        return list
    }, [])

    return (
        <div className="flex-1">
            <div className="mx-2 mb-3 mt-1">
                <Button
                    className={
                        "gap-2 !text-left font-medium !px-3 flex items-center justify-center"
                    }
                    onClick={() => {
                        if (lastPath) router.push(lastPath)
                        else router.back()
                    }}
                >
                    <ArrowLeft size={14} />
                    Back
                </Button>
            </div>

            <Divider className={"mb-3 mt-0 relative left-[-11px] w-[237px]"} />
            <SidebarMenu
                items={items}
                collapsed={false}
                menuProps={{
                    selectedKeys: [tab],
                    className: sidebarClasses.menuContainer,
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
    )
}

export default SettingsSidebar
