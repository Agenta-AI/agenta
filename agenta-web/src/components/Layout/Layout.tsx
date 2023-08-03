import React from "react"
import {Breadcrumb, Layout, theme} from "antd"
import Sidebar from "../Sidebar/Sidebar"
import {HeartTwoTone} from "@ant-design/icons"
import {useRouter} from "next/router"
import Link from "next/link"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
type LayoutProps = {
    children: React.ReactNode
}

const {Content, Footer} = Layout

const App: React.FC<LayoutProps> = ({children}) => {
    const router = useRouter()
    const {app_name: appName} = router.query
    const {
        token: {colorBgContainer},
    } = theme.useToken()
    const capitalizedAppName = renameVariablesCapitalizeAll(appName?.toString() || "")
    return (
        <Layout>
            <Layout hasSider>
                <Sidebar />
                <Content>
                    <div
                        style={{
                            paddingLeft: "24px",
                            paddingRight: "24px",
                            background: colorBgContainer,
                            minHeight: "100vh",
                            marginLeft: 225
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
            <Footer style={{textAlign: "center", padding: "10px 50px"}}>
                <div>
                    <span>Agenta © 2023. Made with</span>
                    <span>
                        {" "}
                        <HeartTwoTone twoToneColor="#eb2f96" />{" "}
                    </span>
                    <span>in Berlin.</span>
                </div>
            </Footer>
        </Layout>
    )
}

export default App
