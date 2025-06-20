import {memo, useEffect, useMemo, useRef, type ReactNode, type RefObject} from "react"

import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {Button, ConfigProvider, Layout, Modal, Skeleton, Space, Typography, theme} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"
import {ErrorBoundary} from "react-error-boundary"
import {ThemeProvider} from "react-jss"
import {useLocalStorage, useResizeObserver} from "usehooks-ts"

import {useAppsData} from "@/oss/contexts/app.context"
import {useOrgData} from "@/oss/contexts/org.context"
import {useProfileData} from "@/oss/contexts/profile.context"
import {DEFAULT_UUID, getCurrentProject, useProjectData} from "@/oss/contexts/project.context"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {useVariants} from "@/oss/lib/hooks/useVariants"

import OldAppDeprecationBanner from "../Banners/OldAppDeprecationBanner"
import CustomWorkflowBanner from "../CustomWorkflowBanner"
import useCustomWorkflowConfig from "../pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import ProtectedRoute from "../ProtectedRoute/ProtectedRoute"

import {BreadcrumbContainer} from "./assets/Breadcrumbs"
import {useStyles, type StyleProps} from "./assets/styles"
import ErrorFallback from "./ErrorFallback"
import {getDeviceTheme, useAppTheme} from "./ThemeContextProvider"

const Sidebar: any = dynamic(() => import("../Sidebar/Sidebar"), {
    ssr: false,
    loading: () => <Skeleton className="w-[236px]" />,
})

type StyleClasses = ReturnType<typeof useStyles>

const {Content, Footer} = Layout

interface LayoutProps {
    children: React.ReactNode
}

const WithVariants = ({
    children,
    handleBackToWorkspaceSwitch,
}: {
    children: ReactNode
    handleBackToWorkspaceSwitch: () => void
}) => {
    const {currentApp} = useAppsData()

    // @ts-ignoree
    const {mutate, data} = useVariants(currentApp)(
        {
            appId: currentApp?.app_id,
        },
        [],
    )

    const variant = useMemo(() => data?.variants?.[0], [data?.variants])

    const {CustomWorkflowModal, openModal} = useCustomWorkflowConfig({
        afterConfigSave: async () => {
            await mutate()
        },
    })

    return (
        <>
            <OldAppDeprecationBanner>
                {variant && (
                    <CustomWorkflowBanner
                        setIsCustomWorkflowModalOpen={openModal}
                        variant={variant}
                    />
                )}
                {children}
            </OldAppDeprecationBanner>
            {CustomWorkflowModal}
        </>
    )
}

const AppWithVariants = memo(
    ({
        children,
        isAppRoute,
        classes,
        isPlayground,
        appTheme,
        ...props
    }: {
        children: ReactNode
        isAppRoute: boolean
        classes: StyleClasses
        appTheme: string
        isPlayground?: boolean
    }) => {
        const {currentApp} = useAppsData()
        const {project, projects} = useProjectData()
        const {changeSelectedOrg} = useOrgData()

        const handleBackToWorkspaceSwitch = () => {
            const project = projects.find((p) => p.user_role === "owner")
            if (project && !project.is_demo && project.organization_id) {
                changeSelectedOrg(project.organization_id)
            }
        }

        return (
            <div>
                {project?.is_demo && (
                    <div className={classes.banner}>
                        You are in <span>a view-only</span> demo workspace. To go back to your
                        workspace{" "}
                        <span className="cursor-pointer" onClick={handleBackToWorkspaceSwitch}>
                            click here
                        </span>
                    </div>
                )}
                <Layout hasSider className={classes.layout}>
                    <Sidebar />
                    <Layout className={classes.layout}>
                        <div className="mb-3">
                            <BreadcrumbContainer
                                appTheme={appTheme}
                                appName={currentApp?.app_name || ""}
                            />
                            {isAppRoute &&
                            (!currentApp ||
                                getCurrentProject().projectId ===
                                    DEFAULT_UUID) ? null : isAppRoute ? (
                                <WithVariants
                                    handleBackToWorkspaceSwitch={handleBackToWorkspaceSwitch}
                                    {...props}
                                >
                                    <Content
                                        className={clsx(classes.content, {
                                            "[&.ant-layout-content]:p-0 [&.ant-layout-content]:m-0":
                                                isPlayground,
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
                                        </ErrorBoundary>
                                    </Content>
                                </WithVariants>
                            ) : (
                                <Content
                                    className={clsx(classes.content, {
                                        "[&.ant-layout-content]:p-0 [&.ant-layout-content]:m-0":
                                            isPlayground,
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
                                    </ErrorBoundary>
                                </Content>
                            )}
                        </div>
                        <Footer className={classes.footer}>
                            <Space className={classes.footerLeft} size={10}>
                                <Link href={"https://github.com/Agenta-AI/agenta"} target="_blank">
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
            </div>
        )
    },
)

const App: React.FC<LayoutProps> = ({children}) => {
    const {user, loading: loadingProfile} = useProfileData()
    const {appTheme} = useAppTheme()
    const {currentApp, isLoading, error} = useAppsData()
    const ref = useRef<HTMLElement | null>(null)
    const {height: footerHeight} = useResizeObserver({
        ref: ref as RefObject<HTMLElement>,
        box: "border-box",
    })
    const {project} = useProjectData()
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const router = useRouter()
    const appId = router.query.app_id as string
    const isDarkTheme = appTheme === "dark"
    const {token} = theme.useToken()
    const [, contextHolder] = Modal.useModal()

    const posthog = usePostHogAg()
    const [hasCapturedTheme, setHasCapturedTheme] = useLocalStorage("hasCapturedTheme", false)

    const userProfile = useMemo(() => !loadingProfile && !!user, [loadingProfile, user])

    useEffect(() => {
        if (!hasCapturedTheme) {
            const deviceTheme = getDeviceTheme()

            posthog?.capture("user_device_theme", {
                $set: {deviceTheme},
            })

            setHasCapturedTheme(true)
        }
    }, [hasCapturedTheme])

    useEffect(() => {
        if (typeof window === "undefined") return

        const body = document.body
        body.classList.remove("dark-mode", "light-mode")
        if (isDarkTheme) {
            body.classList.add("dark-mode")
        } else {
            body.classList.add("light-mode")
        }
    }, [appTheme])

    const {isPlayground, isAppRoute, isAuthRoute} = useMemo(() => {
        return {
            isAuthRoute:
                router.pathname.includes("/auth") ||
                router.pathname.includes("/post-signup") ||
                router.pathname.includes("/workspaces"),
            isAppRoute: router.pathname.startsWith("/apps/[app_id]"),
            isPlayground: router.pathname.includes("/playground"),
        }
    }, [router.pathname, router.query])

    // wait until we have the app id, if its an app route
    if (userProfile && isAppRoute && (!appId || !project)) return null

    if (userProfile && appId && !currentApp && !isLoading && !error) {
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

    return (
        <>
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
                        <ProtectedRoute>
                            <AppWithVariants
                                isAppRoute={isAppRoute}
                                classes={classes}
                                appTheme={appTheme}
                                isPlayground={isPlayground}
                            >
                                <div>
                                    {children}
                                    {contextHolder}
                                </div>
                            </AppWithVariants>
                        </ProtectedRoute>
                    )}
                </ThemeProvider>
            )}
        </>
    )
}

export default memo(App)
