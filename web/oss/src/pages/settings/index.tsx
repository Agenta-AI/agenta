import {useEffect, useMemo} from "react"

import {ApartmentOutlined, KeyOutlined} from "@ant-design/icons"
import {Receipt, Sparkle} from "@phosphor-icons/react"
import {Space, Tabs, Typography} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import ProtectedRoute from "@/oss/components/ProtectedRoute/ProtectedRoute"
import {useProjectData} from "@/oss/contexts/project.context"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {isDemo} from "@/oss/lib/helpers/utils"

const Secrets = dynamic(() => import("@/oss/components/pages/settings/Secrets/Secrets"), {
    ssr: false,
})
const WorkspaceManage = dynamic(
    () => import("@/oss/components/pages/settings/WorkspaceManage/WorkspaceManage"),
    {ssr: false},
)
const APIKeys = dynamic(() => import("@/oss/components/pages/settings/APIKeys/APIKeys"), {
    ssr: false,
})
const Billing = dynamic(() => import("@/oss/components/pages/settings/Billing"), {
    ssr: false,
})

const useStyles = createUseStyles({
    tabs: {
        height: "calc(100vh - 228px)",
        "& .ant-tabs-content-holder": {
            position: "relative",
            overflow: "auto",
        },
    },
})

const Settings: React.FC = () => {
    const [tab, setTab] = useQueryParam("tab", "workspace")
    const classes = useStyles()
    const router = useRouter()
    const {project} = useProjectData()

    useEffect(() => {
        if (project?.is_demo) {
            router.push("/apps")
        }
    }, [project, router])

    const items = useMemo(() => {
        return [
            {
                label: (
                    <Space>
                        <ApartmentOutlined />
                        Workspace
                    </Space>
                ),
                key: "workspace",
                children: <WorkspaceManage />,
            },
            {
                label: (
                    <Space>
                        <Sparkle size={14} className="mt-1" />
                        Model Hub
                    </Space>
                ),
                key: "secrets",
                children: <Secrets />,
            },
            {
                label: (
                    <Space>
                        <KeyOutlined />
                        API Keys
                    </Space>
                ),
                key: "apiKeys",
                children: <APIKeys />,
            },
            ...(isDemo()
                ? [
                      {
                          label: (
                              <Space>
                                  <Receipt size={14} className="mt-1" />
                                  Usage & Billing
                              </Space>
                          ),
                          key: "billing",
                          children: <Billing />,
                      },
                  ]
                : []),
        ]
    }, [])

    return (
        <main className="flex flex-col gap-4">
            <Typography.Title level={4} className="!font-medium">
                Settings
            </Typography.Title>
            <Tabs className={classes.tabs} onChange={setTab} activeKey={tab} items={items} />
        </main>
    )
}

export default () => (
    <ProtectedRoute>
        <Settings />
    </ProtectedRoute>
)
