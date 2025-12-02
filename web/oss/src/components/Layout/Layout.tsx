import {memo, useEffect, useMemo, useRef, type ReactNode, type RefObject} from "react"
import {Suspense} from "react"

import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {ConfigProvider, Layout, Modal, Skeleton, Space, theme} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {ErrorBoundary} from "react-error-boundary"
import {useLocalStorage, useResizeObserver} from "usehooks-ts"

import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {currentAppAtom} from "@/oss/state/app"
import {useAppQuery, useAppState} from "@/oss/state/appState"
import {useProfileData} from "@/oss/state/profile"
import {getProjectValues, useProjectData} from "@/oss/state/project"

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
        isEvaluator,
        appTheme,
        ...props
    }: {
        children: ReactNode
        isAppRoute: boolean
        isHumanEval: boolean
        isEvaluator: boolean
        classes: StyleClasses
        appTheme: string
        isPlayground?: boolean
    }) => {
        const {baseAppURL} = useURL()
        const appState = useAppState()
        const lastNonSettingsRef = useRef<string | null>(null)

        useEffect(() => {
            if (!appState.pathname.includes("/settings")) {
                lastNonSettingsRef.current = appState.asPath
            }
        }, [appState.asPath, appState.pathname])

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
            <div className={clsx([{"flex flex-col grow min-h-0": isHumanEval || isEvaluator}])}>
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
                        showSettingsView={appState.pathname.endsWith("/settings")}
                        lastPath={lastNonSettingsRef.current || baseAppURL}
                    />

                    <Layout className={classes.layout}>
                        <div
                            className={clsx([
                                {"grow flex flex-col min-h-0": isHumanEval || isEvaluator},
                            ])}
                        >
                            <BreadcrumbContainer
                                appTheme={appTheme}
                                appName={currentApp?.app_name || ""}
                            />
                            {isAppRoute && !getProjectValues().projectId ? null : isAppRoute ? (
                                <OldAppDeprecationBanner>
                                    <CustomWorkflowBanner />
                                    <Content
                                        className={clsx(
                                            classes.content,
                                            "[&.ant-layout-content]:p-0",
                                            {
                                                "flex flex-col min-h-0 grow":
                                                    isHumanEval || isEvaluator,
                                                "[&.ant-layout-content]:p-0 [&.ant-layout-content]:m-0":
                                                    isPlayground,
                                            },
                                        )}
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
                                            isPlayground || isEvaluator,
                                        "flex flex-col min-h-0 grow !px-0 !pb-0":
                                            isHumanEval || isEvaluator,
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
                        <div className="w-full h-[20px]"></div>
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
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const appState = useAppState()
    const query = useAppQuery()

    const isDarkTheme = appTheme === "dark"
    const [, contextHolder] = Modal.useModal()
    const posthog = usePostHogAg()
    const [hasCapturedTheme, setHasCapturedTheme] = useLocalStorage("hasCapturedTheme", false)

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

    const {isHumanEval, isPlayground, isAppRoute, isAuthRoute, isEvaluator} = useMemo(() => {
        const pathname = appState.pathname
        const asPath = appState.asPath
        const selectedEvaluation = Array.isArray(query.selectedEvaluation)
            ? query.selectedEvaluation[0]
            : query.selectedEvaluation
        return {
            isAuthRoute:
                pathname.includes("/auth") ||
                pathname.includes("/post-signup") ||
                pathname.includes("/workspaces"),
            isAppRoute: baseAppURL ? asPath.startsWith(baseAppURL) : false,
            isPlayground: pathname.includes("/playground"),
            //  || pathname.includes("/evaluations/results"),
            isEvaluator: pathname.includes("/evaluators/configure"),
            isHumanEval:
                pathname.includes("/evaluations/") || selectedEvaluation === "human_annotation",
        }
    }, [appState.asPath, appState.pathname, baseAppURL, query.selectedEvaluation])

    return (
        <Suspense fallback={<Skeleton />}>
            {typeof window === "undefined" ? null : isAuthRoute ? (
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
                        isEvaluator={isEvaluator}
                    >
                        {children}
                        {contextHolder}
                    </AppWithVariants>
                </ProtectedRoute>
            )}
        </Suspense>
    )
}

export default App
