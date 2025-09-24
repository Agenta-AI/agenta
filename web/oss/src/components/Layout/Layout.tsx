import {memo, useEffect, useMemo, useRef, type ReactNode, type RefObject} from "react"
import {Suspense} from "react"

import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {ConfigProvider, Layout, Modal, Skeleton, Space, theme} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"
import {ErrorBoundary} from "react-error-boundary"
import {ThemeProvider} from "react-jss"
import {useLocalStorage, useResizeObserver} from "usehooks-ts"

import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {currentAppAtom} from "@/oss/state/app"
import {useProfileData} from "@/oss/state/profile"
import {DEFAULT_UUID, getProjectValues, useProjectData} from "@/oss/state/project"

import OldAppDeprecationBanner from "../Banners/OldAppDeprecationBanner"
import CustomWorkflowBanner from "../CustomWorkflowBanner"
import ProtectedRoute from "../ProtectedRoute/ProtectedRoute"

import BreadcrumbContainer from "./assets/Breadcrumbs"
import {useStyles} from "./assets/styles"
import ErrorFallback from "./ErrorFallback"
import {SidebarIsland} from "./SidebarIsland"
import {getDeviceTheme, useAppTheme} from "./ThemeContextProvider"

const FooterIsland = dynamic(() => import("./FooterIsland").then((m) => m.FooterIsland), {
    ssr: false,
    loading: () => null,
})

type StyleClasses = ReturnType<typeof useStyles>

const {Content} = Layout

interface LayoutProps {
    children: React.ReactNode
}

const AppWithVariants = memo(
    ({
        children,
        isAppRoute,
        classes,
        isPlayground,
        isHumanEval,
        appTheme,
        ...props
    }: {
        children: ReactNode
        isAppRoute: boolean
        isHumanEval: boolean
        classes: StyleClasses
        appTheme: string
        isPlayground?: boolean
    }) => {
        const router = useRouter()
        const {baseAppURL} = useURL()
        const lastNonSettingsRef = useRef<string | null>(null)

        useEffect(() => {
            if (!router.pathname.includes("/settings")) {
                lastNonSettingsRef.current = router.asPath
            }
        }, [router.asPath])

        const currentApp = useAtomValue(currentAppAtom)
        const {project, projects} = useProjectData()
        // const profileLoading = useAtomValue(profilePendingAtom)
        // const {changeSelectedOrg} = useOrgData()

        const handleBackToWorkspaceSwitch = () => {
            const project = projects.find((p) => p.user_role === "owner")
            if (project && !project.is_demo && project.organization_id) {
                // changeSelectedOrg(project.organization_id)
            }
        }

        return (
            <div className={clsx([{"flex flex-col grow min-h-0": isHumanEval}])}>
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
                    <SidebarIsland
                        showSettingsView={router.pathname.endsWith("/settings")}
                        lastPath={lastNonSettingsRef.current || baseAppURL}
                    />

                    <Layout className={classes.layout}>
                        <div className={clsx([{"grow flex flex-col min-h-0": isHumanEval}])}>
                            <BreadcrumbContainer
                                appTheme={appTheme}
                                appName={currentApp?.app_name || ""}
                            />
                            {isAppRoute &&
                            getProjectValues().projectId === DEFAULT_UUID ? null : isAppRoute ? (
                                <OldAppDeprecationBanner>
                                    <CustomWorkflowBanner />
                                    <Content
                                        className={clsx(classes.content, {
                                            "flex flex-col min-h-0 grow": isHumanEval,
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
                                </OldAppDeprecationBanner>
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
                        <FooterIsland className={classes.footer}>
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
                        </FooterIsland>
                    </Layout>
                </Layout>
            </div>
        )
    },
)

const App: React.FC<LayoutProps> = ({children}) => {
    // profile used for side-effects in children; values unused here
    useProfileData()
    const {appTheme} = useAppTheme()
    const {baseAppURL} = useURL()
    const ref = useRef<HTMLElement | null>(null)
    const {height: footerHeight} = useResizeObserver({
        ref: ref as RefObject<HTMLElement>,
        box: "border-box",
    })
    // const project = useAtomValue(projectAtom)
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const router = useRouter()

    // const appId = router.query.app_id as string
    const isDarkTheme = appTheme === "dark"
    const {token} = theme.useToken()
    const [, contextHolder] = Modal.useModal()
    // useFetchEvaluatorsData()
    const posthog = usePostHogAg()
    const [hasCapturedTheme, setHasCapturedTheme] = useLocalStorage("hasCapturedTheme", false)

    // const userProfile = useMemo(() => !loadingProfile && !!user, [loadingProfile, user])

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

    const {isHumanEval, isPlayground, isAppRoute, isAuthRoute} = useMemo(() => {
        return {
            isAuthRoute:
                router.pathname.includes("/auth") ||
                router.pathname.includes("/post-signup") ||
                router.pathname.includes("/workspaces"),
            isAppRoute: router.asPath.startsWith(baseAppURL),
            isPlayground:
                router.pathname.includes("/playground") ||
                router.pathname.includes("/evaluations/results"),
            isHumanEval:
                router.pathname.includes("/evaluations/single_model_test") ||
                router.query.selectedEvaluation === "human_annotation",
        }
    }, [router.pathname, router.query, router.asPath, baseAppURL])

    return (
        <Suspense fallback={<Skeleton />}>
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
                                isHumanEval={isHumanEval}
                            >
                                {children}
                                {contextHolder}
                            </AppWithVariants>
                        </ProtectedRoute>
                    )}
                </ThemeProvider>
            )}
        </Suspense>
    )
}

export default App
