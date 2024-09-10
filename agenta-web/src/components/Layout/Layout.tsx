import React, {useEffect, useMemo} from "react"
import {Breadcrumb, Layout, Modal, Space, Typography, theme} from "antd"
import Sidebar from "../Sidebar/Sidebar"
import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import Link from "next/link"
import {isDemo, renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {useAppTheme} from "./ThemeContextProvider"
import {useElementSize} from "usehooks-ts"
import {createUseStyles} from "react-jss"
import NoSSRWrapper from "../NoSSRWrapper/NoSSRWrapper"
import {ErrorBoundary} from "react-error-boundary"
import ErrorFallback from "./ErrorFallback"
import {useAppsData} from "@/contexts/app.context"
import {useRouter} from "next/router"
import {useProfileData} from "@/contexts/profile.context"
import {ThemeProvider} from "react-jss"
import {JSSTheme, StyleProps as MainStyleProps} from "@/lib/Types"
import {Lightning} from "@phosphor-icons/react"
import packageJsonData from "../../../package.json"

const {Content, Footer} = Layout
const {Text} = Typography

interface StyleProps extends MainStyleProps {
    footerHeight: number
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    layout: ({themeMode}: StyleProps) => ({
        display: "flex",
        background: themeMode === "dark" ? "#141414" : "#ffffff",
        height: "100%",
        minHeight: "100vh",
        position: "relative",
    }),
    content: ({footerHeight}: StyleProps) => ({
        height: `calc(100% - ${footerHeight ?? 0}px)`,
        paddingLeft: "1.5rem",
        paddingRight: "1.5rem",
        marginBottom: `calc(2rem + ${footerHeight ?? 0}px)`,
        flex: 1,
    }),
    breadcrumbContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "8px 1.5rem",
        marginBottom: 24,
        borderBottom: "1px solid #eaeff5",
    },
    footer: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        textAlign: "center",
        padding: "5px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    footerLeft: {
        fontSize: 18,
    },
    footerLinkIcon: ({themeMode}: StyleProps) => ({
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
    topRightBar: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        "& span.ant-typography": {
            color: "rgba(0, 0, 0, 0.45)",
        },
    },
}))

type LayoutProps = {
    children: React.ReactNode
}

const App: React.FC<LayoutProps> = ({children}) => {
    const {user} = useProfileData()
    const {appTheme} = useAppTheme()
    const {currentApp} = useAppsData()
    const capitalizedAppName = renameVariablesCapitalizeAll(currentApp?.app_name || "")
    const [footerRef, {height: footerHeight}] = useElementSize()
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const router = useRouter()
    const appId = router.query.app_id as string
    const isDarkTheme = appTheme === "dark"
    const {token} = theme.useToken()
    const [modal, contextHolder] = Modal.useModal()

    useEffect(() => {
        if (user && isDemo()) {
            ;(window as any).intercomSettings = {
                api_base: "https://api-iam.intercom.io",
                app_id: process.env.NEXT_PUBLIC_INTERCOM_APP_ID,
                name: user.username,
                email: user.email,
            }
            ;(function () {
                var w: any = window
                var ic = w.Intercom
                if (typeof ic === "function") {
                    ic("reattach_activator")
                    ic("update", (window as any).intercomSettings)
                } else {
                    var d = document
                    var i: any = function () {
                        i.c(arguments)
                    }
                    i.q = []
                    i.c = function (args: any) {
                        i.q.push(args)
                    }
                    w.Intercom = i
                    var l = function () {
                        var s = d.createElement("script")
                        s.type = "text/javascript"
                        s.async = true
                        s.src = `https://widget.intercom.io/widget/${process.env.NEXT_PUBLIC_INTERCOM_APP_ID}`
                        var x: any = d.getElementsByTagName("script")[0]
                        x.parentNode.insertBefore(s, x)
                    }
                    if (document.readyState === "complete") {
                        l()
                    } else if (w.attachEvent) {
                        w.attachEvent("onload", l)
                    } else {
                        w.addEventListener("load", l, false)
                    }
                }
            })()
        } else {
            if ((window as any).Intercom) {
                ;(window as any).Intercom("shutdown")
                delete (window as any).intercomSettings
            }
        }
    }, [user])

    const isAppRoute = useMemo(
        () => router.pathname.startsWith("/apps/[app_id]"),
        [router.pathname],
    )

    useEffect(() => {
        if (typeof window === "undefined") return () => {}

        const body = document.body
        body.classList.remove("dark-mode", "light-mode")
        if (isDarkTheme) {
            body.classList.add("dark-mode")
        } else {
            body.classList.add("light-mode")
        }
    }, [appTheme])

    // wait unitl we have the app id, if its an app route
    if (isAppRoute && (!appId || !currentApp)) return null

    return (
        <NoSSRWrapper>
            {typeof window === "undefined" ? null : (
                <ThemeProvider theme={{...token, isDark: isDarkTheme}}>
                    <Layout hasSider className={classes.layout}>
                        <Sidebar />
                        <Layout className={classes.layout}>
                            <div>
                                <div className={classes.breadcrumbContainer}>
                                    <Breadcrumb
                                        items={[
                                            {
                                                title: (
                                                    <div className="flex items-center gap-1">
                                                        <Lightning size={16} />
                                                        <Link href="/apps">Apps</Link>
                                                    </div>
                                                ),
                                            },
                                            {title: capitalizedAppName},
                                        ]}
                                    />
                                    <div className={classes.topRightBar}>
                                        <Text>agenta v{packageJsonData.version}</Text>
                                    </div>
                                </div>
                                <Content className={classes.content}>
                                    <ErrorBoundary FallbackComponent={ErrorFallback}>
                                        {children}
                                        {contextHolder}
                                    </ErrorBoundary>
                                </Content>
                            </div>
                            <Footer ref={footerRef} className={classes.footer}>
                                <Space className={classes.footerLeft} size={10}>
                                    <Link
                                        href={"https://github.com/Agenta-AI/agenta"}
                                        target="_blank"
                                    >
                                        <GithubFilled className={classes.footerLinkIcon} />
                                    </Link>
                                    <Link
                                        href={"https://www.linkedin.com/company/agenta-ai/"}
                                        target="_blank"
                                    >
                                        <LinkedinFilled className={classes.footerLinkIcon} />
                                    </Link>
                                    <Link href={"https://twitter.com/agenta_ai"} target="_blank">
                                        <TwitterOutlined className={classes.footerLinkIcon} />
                                    </Link>
                                </Space>
                                <div>Copyright © {new Date().getFullYear()} | Agenta.</div>
                            </Footer>
                        </Layout>
                    </Layout>
                </ThemeProvider>
            )}
        </NoSSRWrapper>
    )
}

export default App
