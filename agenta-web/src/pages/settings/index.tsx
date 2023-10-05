import ApiKeys from "@/components/ApiKeys/ApiKeys"
import ProtectedRoute from "@/components/ProtectedRoute/ProtectedRoute"
import {useQueryParam} from "@/hooks/useQuery"
import {dynamicComponent, isDemo} from "@/lib/helpers/utils"
import {ApartmentOutlined, GlobalOutlined, LockOutlined} from "@ant-design/icons"
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
    const [tab, setTab] = useQueryParam("tab", isDemo() ? "workspace" : "apikeys")
    const classes = useStyles()

    const WorkspaceManage = isDemo()
        ? dynamicComponent(`pages/settings/WorkspaceManage/WorkspaceManage`)
        : () => null

    return (
        <div className={classes.root}>
            <Typography.Title className={classes.heading} level={3}>
                Settings
            </Typography.Title>
            <Tabs
                className={classes.tabs}
                onChange={setTab}
                defaultActiveKey={tab}
                items={[
                    ...(isDemo()
                        ? [
                              {
                                  label: (
                                      <span>
                                          <ApartmentOutlined />
                                          Workspace
                                      </span>
                                  ),
                                  key: "workspace",
                                  children: <WorkspaceManage />,
                              },
                          ]
                        : []),
                    {
                        label: (
                            <span>
                                <LockOutlined />
                                API Keys
                            </span>
                        ),
                        key: "apikeys",
                        children: <ApiKeys />,
                    },
                ]}
            />
        </div>
    )
}

export default () => (
    <ProtectedRoute>
        <Settings />
    </ProtectedRoute>
)
