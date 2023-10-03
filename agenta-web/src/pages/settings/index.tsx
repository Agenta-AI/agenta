import {useQueryParam} from "@/hooks/useQuery"
import {ApartmentOutlined, GlobalOutlined, LockOutlined} from "@ant-design/icons"
import {Tabs, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

const isDemo = process.env.NEXT_PUBLIC_FF === "demo"

let WorkspaceManage = () => null
if (isDemo) {
    import("@/components/pages/settings/WorkspaceManage/WorkspaceManage" as any).then(
        (mod) => (WorkspaceManage = mod.default),
    )
}

const useStyles = createUseStyles({
    root: {
        display: "flex",
        flexDirection: "column",
    },
    heading: {
        marginBottom: "2rem !important",
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
    const [tab, setTab] = useQueryParam("tab", isDemo ? "workspace" : "apikeys")
    const classes = useStyles()

    return (
        <div className={classes.root}>
            <Typography.Title className={classes.heading} level={3}>
                Settings
            </Typography.Title>
            <Tabs
                className={classes.tabs}
                onChange={setTab}
                tabPosition="left"
                defaultActiveKey={tab}
                items={[
                    isDemo
                        ? {
                              label: (
                                  <span>
                                      <ApartmentOutlined />
                                      Workspace
                                  </span>
                              ),
                              key: "workspace",
                              children: <WorkspaceManage />,
                          }
                        : {
                              label: (
                                  <span>
                                      <LockOutlined />
                                      API Keys
                                  </span>
                              ),
                              key: "apikeys",
                              children: <div>API Keys</div>,
                          },
                    {
                        label: (
                            <span>
                                <GlobalOutlined />
                                Languages
                            </span>
                        ),
                        key: "languages",
                        children: <div>Coming Soon!</div>,
                    },
                ]}
            />
        </div>
    )
}

export default Settings
