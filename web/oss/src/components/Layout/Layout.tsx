import {
    memo,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react"

import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {ConfigProvider, Layout, Modal, Skeleton, Space, theme} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {ErrorBoundary} from "react-error-boundary"
import {useLocalStorage, useResizeObserver} from "usehooks-ts"

import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {currentAppAtom} from "@/oss/state/app"
import {requestNavigationAtom, useAppQuery, useAppState} from "@/oss/state/appState"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {getProjectValues, useProjectData} from "@/oss/state/project"
import {
    cacheLastUsedProjectId,
    demoReturnHintDismissedAtom,
    demoReturnHintPendingAtom,
    lastNonDemoProjectAtom,
} from "@/oss/state/project/selectors/project"

import OldAppDeprecationBanner from "../Banners/OldAppDeprecationBanner"
import CustomWorkflowBanner from "../CustomWorkflow/CustomWorkflowBanner"
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
        isTestsets,
        isEvaluator,
        appTheme,
        footerHeight,
        ...props
    }: {
        children: ReactNode
        isAppRoute: boolean
        isHumanEval: boolean
        isEvaluator: boolean
        isTestsets: boolean
        classes: StyleClasses
        appTheme: string
        isPlayground?: boolean
        footerHeight?: number
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
        const {project} = useProjectData()
        const lastNonDemoProject = useAtomValue(lastNonDemoProjectAtom)
        const [demoReturnHintPending, setDemoReturnHintPending] = useAtom(demoReturnHintPendingAtom)
        const [demoReturnHintDismissed, setDemoReturnHintDismissed] = useAtom(
            demoReturnHintDismissedAtom,
        )
        const [isDemoReturnModalOpen, setDemoReturnModalOpen] = useState(false)
        const navigate = useSetAtom(requestNavigationAtom)
        // const profileLoading = useAtomValue(profilePendingAtom)
        // const {changeSelectedOrg} = useOrgData()

        useEffect(() => {
            if (project?.is_demo) return
            if (!demoReturnHintPending) return
            if (demoReturnHintDismissed) {
                setDemoReturnHintPending(false)
                return
            }
            setDemoReturnHintPending(false)
            setDemoReturnModalOpen(true)
        }, [
            demoReturnHintDismissed,
            demoReturnHintPending,
            project?.is_demo,
            setDemoReturnHintPending,
        ])

        const closeDemoReturnModal = useCallback(() => {
            setDemoReturnModalOpen(false)
            setDemoReturnHintDismissed(true)
        }, [setDemoReturnHintDismissed])

        const handleBackToWorkspaceSwitch = useCallback(() => {
            if (!lastNonDemoProject?.workspaceId || !lastNonDemoProject?.projectId) {
                navigate({type: "href", href: "/w", method: "push"})
                return
            }

            cacheLastUsedProjectId(lastNonDemoProject.workspaceId, lastNonDemoProject.projectId)

            if (lastNonDemoProject.organizationId) {
                cacheWorkspaceOrgPair(
                    lastNonDemoProject.workspaceId,
                    lastNonDemoProject.organizationId,
                )
            }

            if (!demoReturnHintDismissed) {
                setDemoReturnHintPending(true)
            }
            const href = `/w/${encodeURIComponent(
                lastNonDemoProject.workspaceId,
            )}/p/${encodeURIComponent(lastNonDemoProject.projectId)}/apps`
            navigate({type: "href", href, method: "push"})
        }, [demoReturnHintDismissed, lastNonDemoProject, navigate, setDemoReturnHintPending])

        return (
            <div className={clsx([{"flex flex-col grow min-h-0": isHumanEval || isEvaluator}])}>
                <Modal
                    title="Want to revisit the demo?"
                    open={isDemoReturnModalOpen}
                    onOk={closeDemoReturnModal}
                    onCancel={closeDemoReturnModal}
                    okText="Got it"
                    cancelText="Do not show again"
                >
                    <p className="m-0">
                        Open the org switcher in the sidebar. Select the organization tagged demo to
                        return.
                    </p>
                </Modal>
                {project?.is_demo && (
                    <>
                        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-1.5 h-[38px] bg-[#1c2c3d] text-white text-sm font-medium">
                            You're viewing the demo workspace.
                            <button
                                type="button"
                                className="bg-transparent border-none p-0 text-white text-sm font-medium underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer"
                                onClick={handleBackToWorkspaceSwitch}
                            >
                                Return to your workspace
                            </button>
                        </div>
                        <div className="h-[38px] shrink-0" />
                    </>
                )}
                <Layout hasSider className={classes.layout}>
                    <SidebarIsland
                        showSettingsView={appState.pathname.endsWith("/settings")}
                        lastPath={lastNonSettingsRef.current || baseAppURL}
                    />

                    <Layout className={classes.layout}>
                        <div
                            className={clsx([
                                {
                                    "grow flex flex-col min-h-0":
                                        isHumanEval || isEvaluator || isTestsets,
                                },
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
                                            "flex gap-4 flex-col w-full",
                                            // "h-[calc(100%-30px)]",
                                            {
                                                "pb-0 mb-8": !isHumanEval,
                                                "flex flex-col min-h-0 grow":
                                                    isHumanEval || isEvaluator || isTestsets,
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
                                                {isHumanEval || isEvaluator || isTestsets ? (
                                                    <div
                                                        className={clsx(
                                                            "w-full flex min-h-0 flex-col gap-6 h-[calc(100dvh-75px)] overflow-hidden",
                                                        )}
                                                    >
                                                        {children}
                                                    </div>
                                                ) : (
                                                    children
                                                )}
                                            </ConfigProvider>
                                        </ErrorBoundary>
                                    </Content>
                                </OldAppDeprecationBanner>
                            ) : (
                                <Content
                                    className={clsx("flex gap-4", "h-[calc(100%-30px)]", {
                                        "pb-0 mb-8": !(isHumanEval || isEvaluator || isTestsets),
                                        "flex flex-col min-h-0 grow":
                                            isHumanEval || isEvaluator || isTestsets,
                                        "[&.ant-layout-content]:p-0 [&.ant-layout-content]:m-0":
                                            isPlayground || isEvaluator,
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
                                            <div
                                                className={clsx("w-full flex flex-col", {
                                                    "min-h-0 gap-6 h-[calc(100dvh-75px)] overflow-hidden":
                                                        isHumanEval || isEvaluator || isTestsets,
                                                })}
                                            >
                                                {children}
                                            </div>
                                        </ConfigProvider>
                                    </ErrorBoundary>
                                </Content>
                            )}
                        </div>
                        <div className="w-full h-[30px]"></div>
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

    const {isHumanEval, isTestsets, isPlayground, isAppRoute, isAuthRoute, isEvaluator} =
        useMemo(() => {
            const pathname = appState.pathname
            const asPath = appState.asPath
            const selectedEvaluation = Array.isArray(query.selectedEvaluation)
                ? query.selectedEvaluation[0]
                : query.selectedEvaluation
            return {
                isAuthRoute:
                    pathname.includes("/auth") ||
                    pathname.includes("/post-signup") ||
                    pathname.includes("/get-started") ||
                    pathname.includes("/workspaces"),
                isAppRoute: baseAppURL ? asPath.startsWith(baseAppURL) : false,
                isPlayground: pathname.includes("/playground"),
                //  || pathname.includes("/evaluations/results"),
                isEvaluator: pathname.includes("/evaluators/configure"),
                isHumanEval:
                    pathname.includes("/evaluations") || selectedEvaluation === "human_annotation",
                isTestsets: pathname.includes("/testsets") || pathname.includes("/prompts"),
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
                        isTestsets={isTestsets}
                        footerHeight={footerHeight}
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
