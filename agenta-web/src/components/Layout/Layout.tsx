import React from "react"
import {Breadcrumb, ConfigProvider, Layout, theme} from "antd"
import Sidebar from "../Sidebar/Sidebar"
import {HeartTwoTone} from "@ant-design/icons"
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
            <Layout hasSider>
                <Sidebar />
                <Content>
                    <div
                        style={{
                            paddingLeft: "24px",
                            paddingRight: "24px",
                            background: appTheme === "dark" ? "#141414" : "#ffffff",
                            minHeight: "100vh",
                            marginLeft: 225,
                        }}
                    >
                        <Breadcrumb
                            style={{paddingTop: "24px", paddingBottom: "24px"}}
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
                    padding: "7px",
                    marginLeft: "225px",
                    maxHeight: "30px",
                }}
            >
                <div>
                    <span>Agenta © {new Date().getFullYear()}. Made with</span>
                    <span>
                        {" "}
                        <HeartTwoTone twoToneColor="#eb2f96" />{" "}
                    </span>
                    <span>in Berlin.</span>
                </div>
            </Footer>
        </ConfigProvider>
    )
}

export default App
