import {memo, useEffect, useMemo} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"

import {Button, ConfigProvider, Layout, Modal, Skeleton, Space, Typography, theme} from "antd"
import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import Link from "next/link"
import {isDemo} from "@/lib/helpers/utils"
import {useAppTheme} from "./ThemeContextProvider"
import {useElementSize} from "usehooks-ts"

import NoSSRWrapper from "../NoSSRWrapper/NoSSRWrapper"
import {ErrorBoundary} from "react-error-boundary"
import ErrorFallback from "./ErrorFallback"
import {useAppsData} from "@/contexts/app.context"
import {useRouter} from "next/router"
import {useProfileData} from "@/contexts/profile.context"
import {ThemeProvider} from "react-jss"
import {useProjectData} from "@/contexts/project.context"
import {useOrgData} from "@/contexts/org.context"
import {dynamicComponent} from "@/lib/helpers/dynamic"

import {useStyles, type StyleProps} from "./assets/styles"
import {BreadcrumbContainer} from "./assets/Breadcrumbs"
import {useVariants} from "@/lib/hooks/useVariants"

const Sidebar: any = dynamic(() => import("../Sidebar/Sidebar"), {
    ssr: false,
    loading: () => <Skeleton className="w-[236px]" />,
})

const {Content, Footer} = Layout
const {Text} = Typography

type LayoutProps = {
    children: React.ReactNode
}

const WithVariants = ({children, currentApp}) => {
    useVariants(currentApp)(
        {
            appId: currentApp?.app_id,
        },
        [],
    )

    return <>{children}</>
}

const AppWithVariants = memo(({children, isAppRoute}) => {
    const {currentApp} = useAppsData()

    if (isAppRoute) {
        if (!currentApp) {
            return null
        } else {
            return <WithVariants currentApp={currentApp}>{children}</WithVariants>
        }
    } else {
        return <>{children}</>
    }
})

const App: React.FC<LayoutProps> = ({children}) => {
    const {user} = useProfileData()
    const {appTheme} = useAppTheme()
    const {currentApp, isLoading, error} = useAppsData()
    const [footerRef, {height: footerHeight}] = useElementSize()
    const {project, projects} = useProjectData()
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const router = useRouter()
    const appId = router.query.app_id as string
    const isDarkTheme = appTheme === "dark"
    const {token} = theme.useToken()
    const [modal, contextHolder] = Modal.useModal()
    const {changeSelectedOrg} = useOrgData()

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

    const {isNewPlayground, isAppRoute, isAuthRoute} = useMemo(() => {
        return {
            isAuthRoute:
                router.pathname.includes("/auth") || router.pathname.includes("/post-signup"),
            isAppRoute: router.pathname.startsWith("/apps/[app_id]"),
            isNewPlayground:
                router.pathname.includes("/playground") &&
                router.query.playground === "new-playground",
        }
    }, [router.pathname, router.query])

    // wait until we have the app id, if its an app route
    if (isAppRoute && (!appId || !project)) return null

    if (appId && !currentApp && !isLoading && !error) {
        return (
            <div className={classes.notFoundContainer}>
                <Typography.Text>404 - Page Not Found</Typography.Text>
                <Typography.Text>This page could not be found.</Typography.Text>

                <Button type="primary" onClick={() => router.push("/apps")}>
                    Back To Apps
                </Button>
            </div>
        )
    }

    const handleBackToWorkspaceSwitch = () => {
        const project = projects.find((p) => p.user_role === "owner")
        if (project && !project.is_demo && project.organization_id) {
            changeSelectedOrg(project.organization_id)
        }
    }

    return (
        <NoSSRWrapper>
            {typeof window === "undefined" ? null : (
                <ThemeProvider theme={{...token, isDark: isDarkTheme}}>
                    {isAuthRoute ? (
                        <Layout className={classes.layout}>
                            <ErrorBoundary FallbackComponent={ErrorFallback}>
                                {children}
                                {contextHolder}
                            </ErrorBoundary>
                        </Layout>
                    ) : (
                        <AppWithVariants isAppRoute={isAppRoute}>
                            <div>
                                {project?.is_demo && (
                                    <div className={classes.banner}>
                                        You are in <span>a view-only</span> demo workspace. To go
                                        back to your workspace{" "}
                                        <span
                                            className="cursor-pointer"
                                            onClick={handleBackToWorkspaceSwitch}
                                        >
                                            click here
                                        </span>
                                    </div>
                                )}
                                <Layout hasSider className={classes.layout}>
                                    <Sidebar />
                                    <Layout className={classes.layout}>
                                        <div>
                                            <BreadcrumbContainer
                                                appTheme={appTheme}
                                                appName={currentApp?.app_name}
                                                isNewPlayground={isNewPlayground}
                                            />
                                            <Content
                                                className={clsx(classes.content, {
                                                    "[&.ant-layout-content]:p-0 [&.ant-layout-content]:m-0":
                                                        isNewPlayground,
                                                })}
                                            >
                                                <ErrorBoundary FallbackComponent={ErrorFallback}>
                                                    <ConfigProvider
                                                        theme={{
                                                            algorithm:
                                                                appTheme === "dark"
                                                                    ? theme.darkAlgorithm
                                                                    : theme.defaultAlgorithm,
                                                        }}
                                                    >
                                                        {children}
                                                    </ConfigProvider>
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
                                                    <GithubFilled
                                                        className={classes.footerLinkIcon}
                                                    />
                                                </Link>
                                                <Link
                                                    href={
                                                        "https://www.linkedin.com/company/agenta-ai/"
                                                    }
                                                    target="_blank"
                                                >
                                                    <LinkedinFilled
                                                        className={classes.footerLinkIcon}
                                                    />
                                                </Link>
                                                <Link
                                                    href={"https://twitter.com/agenta_ai"}
                                                    target="_blank"
                                                >
                                                    <TwitterOutlined
                                                        className={classes.footerLinkIcon}
                                                    />
                                                </Link>
                                            </Space>
                                            <div>
                                                Copyright © {new Date().getFullYear()} | Agenta.
                                            </div>
                                        </Footer>
                                    </Layout>
                                </Layout>
                            </div>
                        </AppWithVariants>
                    )}
                </ThemeProvider>
            )}
        </NoSSRWrapper>
    )
}

export default memo(App)
