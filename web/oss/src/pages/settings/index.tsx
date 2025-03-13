import {useEffect} from "react"

import {ApartmentOutlined, KeyOutlined, LockOutlined} from "@ant-design/icons"
import {Space, Tabs, Typography} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import ProtectedRoute from "@/oss/components/ProtectedRoute/ProtectedRoute"
import {useProjectData} from "@/oss/contexts/project.context"
import {useQueryParam} from "@/oss/hooks/useQuery"

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

const useStyles = createUseStyles({
    root: {
        display: "flex",
        flexDirection: "column",
    },
    heading: {
        marginTop: "1rem",
        marginBottom: "1rem !important",
    },
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

    const items = [
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
                    <LockOutlined />
                    LLM Keys
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
    ]

    return (
        <div className={classes.root}>
            <Typography.Title className={classes.heading} level={3}>
                Settings
            </Typography.Title>
            <Tabs className={classes.tabs} onChange={setTab} activeKey={tab} items={items} />
        </div>
    )
}

export default () => (
    <ProtectedRoute>
        <Settings />
    </ProtectedRoute>
)
