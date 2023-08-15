import React from "react"
import {Breadcrumb, ConfigProvider, Layout, Space, theme} from "antd"
import Sidebar from "../Sidebar/Sidebar"
import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"
import Link from "next/link"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {useAppTheme} from "./ThemeContextProvider"
type LayoutProps = {
    children: React.ReactNode
}

const {Content, Footer} = Layout

const App: React.FC<LayoutProps> = ({children}) => {
    const router = useRouter()
    const {app_name: appName} = router.query
    const {appTheme} = useAppTheme()
    const {
        token: {colorBgContainer},
    } = theme.useToken()
    const capitalizedAppName = renameVariablesCapitalizeAll(appName?.toString() || "")
    return (
        <ConfigProvider
            theme={{
                algorithm: appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
            }}
        >
            <Layout
                hasSider
                style={{display: "flex", background: appTheme === "dark" ? "#141414" : "#ffffff"}}
            >
                <Sidebar />
                <Content style={{height: "100%", flex: 1}}>
                    <div
                        style={{
                            paddingLeft: "24px",
                            paddingRight: "24px",
                            height: "100%",
                            marginLeft: 225,
                            minHeight: "100vh",
                            marginBottom: "5%",
                        }}
                    >
                        <Breadcrumb
                            style={{paddingTop: "34px", paddingBottom: "24px"}}
                            items={[
                                {title: <Link href="/apps">Apps</Link>},
                                {title: capitalizedAppName},
                            ]}
                        />
                        {children}
                    </div>
                </Content>
            </Layout>
            <Footer
                style={{
                    textAlign: "center",
                    padding: "5px 20px",
                    marginLeft: "225px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "calc(100% - 225px)",
                }}
            >
                <Space style={{fontSize: 18, color: "#000"}} size={10}>
                    <Link href={"https://github.com/Agenta-AI/agenta"} target="_blank">
                        <GithubFilled style={{color: appTheme === "dark" ? "#fff" : "#000"}} />
                    </Link>
                    <Link href={"https://www.linkedin.com/company/agenta-ai/"} target="_blank">
                        <LinkedinFilled style={{color: appTheme === "dark" ? "#fff" : "#000"}} />
                    </Link>
                    <Link href={"https://twitter.com/agenta_ai"} target="_blank">
                        <TwitterOutlined style={{color: appTheme === "dark" ? "#fff" : "#000"}} />
                    </Link>
                </Space>
                <div>Copyright © {new Date().getFullYear()} | Agenta.</div>
            </Footer>
        </ConfigProvider>
    )
}

export default App
