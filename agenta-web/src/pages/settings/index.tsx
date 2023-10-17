import Secrets from "@/components/pages/settings/Secrets/Secrets"
import ProtectedRoute from "@/components/ProtectedRoute/ProtectedRoute"
import {useQueryParam} from "@/hooks/useQuery"
import {isFeatureEnabled} from "@/lib/helpers/featureFlag"
import {dynamicComponent, isDemo} from "@/lib/helpers/utils"
import {ApartmentOutlined, KeyOutlined, LockOutlined} from "@ant-design/icons"
import {Tabs, Typography} from "antd"
import {createUseStyles} from "react-jss"

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
    const [tab, setTab] = useQueryParam("tab", isDemo() ? "workspace" : "secrets")
    const classes = useStyles()

    //dynamic components for demo
    const WorkspaceManage = dynamicComponent(`pages/settings/WorkspaceManage/WorkspaceManage`)
    const APIKeys = dynamicComponent(`pages/settings/APIKeys/APIKeys`)

    const items = [
        {
            label: (
                <span>
                    <ApartmentOutlined />
                    Workspace
                </span>
            ),
            key: "workspace",
            children: <WorkspaceManage />,
            hidden: !isDemo(),
        },
        {
            label: (
                <span>
                    <LockOutlined />
                    LLM Keys
                </span>
            ),
            key: "secrets",
            children: <Secrets />,
        },
        {
            label: (
                <span>
                    <KeyOutlined />
                    API Keys
                </span>
            ),
            key: "apiKeys",
            children: <APIKeys />,
            hidden: !isDemo() || isFeatureEnabled("API_KEYS"),
        },
    ]

    return (
        <div className={classes.root}>
            <Typography.Title className={classes.heading} level={3}>
                Settings
            </Typography.Title>
            <Tabs
                className={classes.tabs}
                onChange={setTab}
                activeKey={tab}
                items={items.filter((item) => !item.hidden)}
            />
        </div>
    )
}

export default () => (
    <ProtectedRoute>
        <Settings />
    </ProtectedRoute>
)
