import {FC, useMemo} from "react"

import {ApartmentOutlined, KeyOutlined} from "@ant-design/icons"
import {ArrowLeft, Sparkle, Receipt} from "@phosphor-icons/react"
import {Button} from "antd"
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
            <Button
                type="link"
                className={"p-0 !text-left font-medium flex items-center justify-start"}
                icon={<ArrowLeft size={14} className="mt-0.5" />}
                onClick={() => {
                    if (lastPath) router.push(lastPath)
                    else router.back()
                }}
            >
                Back
            </Button>
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
