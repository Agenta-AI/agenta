import {memo, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject} from "react"

import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {ConfigProvider, Layout, Modal, Space, theme} from "antd"
import clsx from "clsx"
import {atom} from "jotai"
import {useAtom, useAtomValue, useSetAtom, useStore} from "jotai"
import {selectAtom} from "jotai/utils"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"
import {ErrorBoundary} from "react-error-boundary"
import {useResizeObserver} from "usehooks-ts"

import useURL from "@/oss/hooks/useURL"
import {currentAppAtom} from "@/oss/state/app"
import {appStateSnapshotAtom, requestNavigationAtom, useAppState} from "@/oss/state/appState"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {getProjectValues, useProjectData} from "@/oss/state/project"
import {
    cacheLastUsedProjectId,
    demoReturnHintDismissedAtom,
    demoReturnHintPendingAtom,
    lastNonDemoProjectAtom,
} from "@/oss/state/project/selectors/project"

import CustomWorkflowBanner from "../CustomWorkflow/CustomWorkflowBanner"
import ProtectedRoute from "../ProtectedRoute/ProtectedRoute"

import BreadcrumbContainer from "./assets/Breadcrumbs"
import {useStyles} from "./assets/styles"
import ErrorFallback from "./ErrorFallback"
import PostHogThemeCapture from "./PostHogThemeCapture"
import {SidebarIsland} from "./SidebarIsland"
import {useAppTheme} from "./ThemeContextProvider"

interface LayoutRouteFlags {
    isAuthRoute: boolean
    isAppRoute: boolean
    isPlayground: boolean
    isHumanEval: boolean
    isEvaluator: boolean
    /** isFullHeight — full-height constrained layout */
    isFullHeight: boolean
}

const layoutRouteFlagsAtom = atom<LayoutRouteFlags>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const {pathname, query, routeLayer} = snapshot

    const selectedEvaluation = Array.isArray(query.selectedEvaluation)
        ? query.selectedEvaluation[0]
        : query.selectedEvaluation

    const isHumanEval =
        pathname.includes("/evaluations") || selectedEvaluation === "human_annotation"
    const isEvaluator = pathname.includes("/evaluators")
    const isTestsets = pathname.includes("/testsets") || pathname.includes("/prompts")
    const isAnnotations = pathname.includes("/annotations")
    const isRegistry = pathname.includes("/variants")
    const isObservability = pathname.includes("/observability") || pathname.includes("/traces")
    // The Audit Log settings tab hosts a full-height InfiniteVirtualTable.
    // Scoped to the `tab` query param so other settings tabs keep the default
    // (content-flow) layout.
    const tab = Array.isArray(query.tab) ? query.tab[0] : query.tab
    const isAuditLog = pathname.includes("/settings") && tab === "auditLog"

    return {
        isAuthRoute:
            pathname.includes("/auth") ||
            pathname.includes("/post-signup") ||
            pathname.includes("/get-started") ||
            pathname.includes("/workspaces"),
        isAppRoute: routeLayer === "app",
        isPlayground: pathname.includes("/playground"),
        isHumanEval,
        isEvaluator,
        isFullHeight:
            isHumanEval ||
            isEvaluator ||
            isTestsets ||
            isAnnotations ||
            isRegistry ||
            isObservability ||
            isAuditLog,
    }
})

const selectedLayoutRouteFlagsAtom = selectAtom(
    layoutRouteFlagsAtom,
    (flags) => flags,
    (a, b) =>
        a.isAuthRoute === b.isAuthRoute &&
        a.isAppRoute === b.isAppRoute &&
        a.isPlayground === b.isPlayground &&
        a.isHumanEval === b.isHumanEval &&
        a.isEvaluator === b.isEvaluator &&
        a.isFullHeight === b.isFullHeight,
)

/**
 * The layout flags are derived from the in-flight pathname, which Next flips at
 * `routeChangeStart` — before the destination page mounts. During that window the
 * *outgoing* page is still in the DOM, so leaving a full-height table page for a
 * content-flow page would briefly strip the table's `overflow-hidden` bound and
 * make it reflow/jump until the new page took over.
 *
 * This hook keeps the flags pinned to the *committed* route: while a navigation is
 * in flight we freeze the last value and only adopt the new flags on
 * `routeChangeComplete` (when Next swaps the page in). Same-route updates (e.g. the
 * settings `?tab=audit-log` toggle) aren't page swaps, so they're adopted
 * immediately when idle.
 */
const useCommittedLayoutFlags = (): LayoutRouteFlags => {
    const store = useStore()
    const router = useRouter()
    const liveFlags = useAtomValue(selectedLayoutRouteFlagsAtom)
    const [committedFlags, setCommittedFlags] = useState(liveFlags)
    const navigatingRef = useRef(false)

    useEffect(() => {
        const onStart = () => {
            navigatingRef.current = true
        }
        const onComplete = () => {
            navigatingRef.current = false
            setCommittedFlags(store.get(selectedLayoutRouteFlagsAtom))
        }
        router.events.on("routeChangeStart", onStart)
        router.events.on("routeChangeComplete", onComplete)
        router.events.on("routeChangeError", onComplete)
        return () => {
            router.events.off("routeChangeStart", onStart)
            router.events.off("routeChangeComplete", onComplete)
            router.events.off("routeChangeError", onComplete)
        }
    }, [router, store])

    useEffect(() => {
        // Adopt live flags immediately when no navigation is in flight (initial
        // mount, same-route query changes, and as a self-heal if the snapshot
        // settles after routeChangeComplete).
        if (!navigatingRef.current) setCommittedFlags(liveFlags)
    }, [liveFlags])

    return committedFlags
}

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
        isFullHeight,
        appTheme,
        footerHeight,
    }: {
        children: ReactNode
        isAppRoute: boolean
        isHumanEval: boolean
        isEvaluator: boolean
        isFullHeight: boolean
        classes: StyleClasses
        appTheme: string
        isPlayground?: boolean
        footerHeight?: number
    }) => {
        const {baseAppURL} = useURL()
        const appState = useAppState()
        const isAnnotations = appState.pathname.includes("/annotations")
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
            <div className={clsx([{"flex flex-col grow min-h-0": isFullHeight}])}>
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
                        <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-1.5 h-[38px] bg-[var(--ag-c-1C2C3D)] text-white text-sm font-medium">
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
                                    "grow flex flex-col min-h-0": isFullHeight,
                                },
                            ])}
                        >
                            <BreadcrumbContainer
                                appTheme={appTheme}
                                appName={currentApp?.name ?? currentApp?.slug ?? ""}
                            />
                            {isAppRoute && !getProjectValues().projectId ? null : isAppRoute ? (
                                <>
                                    <CustomWorkflowBanner />
                                    <Content
                                        className={clsx("flex gap-4 flex-col w-full", {
                                            "pb-0 mb-8": !isFullHeight,
                                            "flex flex-col min-h-0 grow": isFullHeight,
                                            "[&.ant-layout-content]:p-0 [&.ant-layout-content]:m-0":
                                                isPlayground || isAnnotations,
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
                                                {isFullHeight ? (
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
                                </>
                            ) : (
                                <Content
                                    className={clsx("flex gap-4", "h-[calc(100%-30px)]", {
                                        "pb-0 mb-8": !isFullHeight,
                                        "flex flex-col min-h-0 grow": isFullHeight,
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
                                                        isFullHeight,
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
    const {appTheme} = useAppTheme()
    const ref = useRef<HTMLElement | null>(null)
    const {height: footerHeight} = useResizeObserver({
        ref: ref as RefObject<HTMLElement>,
        box: "border-box",
    })
    const classes = useStyles({themeMode: appTheme, footerHeight} as StyleProps)
    const {isHumanEval, isPlayground, isAppRoute, isAuthRoute, isEvaluator, isFullHeight} =
        useCommittedLayoutFlags()

    const [, contextHolder] = Modal.useModal()

    return (
        <>
            <PostHogThemeCapture />
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
                        isFullHeight={isFullHeight}
                        footerHeight={footerHeight}
                    >
                        {children}
                        {contextHolder}
                    </AppWithVariants>
                </ProtectedRoute>
            )}
        </>
    )
}

export default App
