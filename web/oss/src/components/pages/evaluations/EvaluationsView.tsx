import {memo, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties} from "react"

import {Tabs, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
// import {createUseStyles} from "react-jss"

import {
    EvaluationRunsTablePOC,
    type EvaluationRunKind,
} from "@/oss/components/EvaluationRunsTablePOC"
import {evaluationRunsTableContextSetterAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/context"
import {evaluationRunsTypeFiltersAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/view"
import {useAppId} from "@/oss/hooks/useAppId"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
// import {JSSTheme} from "@/oss/lib/Types"
import {useQueryParamState} from "@/oss/state/appState"
import {projectIdAtom} from "@/oss/state/project"

import {ConcreteEvaluationRunKind} from "../../EvaluationRunsTablePOC/types"
const AbTestingEvaluation = dynamic(
    () => import("@/oss/components/HumanEvaluations/AbTestingEvaluation"),
    {ssr: false},
)

// const useStyles = createUseStyles((theme: JSSTheme) => ({
//     container: {
//         display: "flex",
//         flexDirection: "column",
//         gap: theme.marginLG,
//     },
//     title: {
//         fontSize: theme.fontSizeLG,
//         fontWeight: theme.fontWeightMedium,
//         lineHeight: theme.lineHeightHeading4,
//     },
// }))

type EvaluationScope = "app" | "project"
type AppTabKey = EvaluationRunKind | "human_ab_testing"

const TAB_CONTENT_SWITCH_DELAY_MS = 220

const APP_TAB_COLOR_MAP: Record<AppTabKey, string> = {
    all: "#e0f2fe",
    auto: "#dbeafe",
    human: "#ede9fe",
    online: "#dcfce7",
    custom: "#fce7f3",
    human_ab_testing: "#fef3f7",
}

const APP_TAB_ITEMS: {key: AppTabKey; label: string}[] = [
    {key: "all", label: "All Evaluations"},
    {key: "auto", label: "Automatic Evaluations"},
    {key: "human", label: "Human Evaluations"},
    {key: "online", label: "Online Evaluations"},
    {key: "custom", label: "SDK Evaluations"},
    {key: "human_ab_testing", label: "Human AB Testing"},
]

const POC_TAB_ITEMS: {key: AppTabKey; label: string}[] = [
    {key: "all", label: "All Evaluations"},
    {key: "auto", label: "Automatic Evaluations"},
    {key: "human", label: "Human Evaluations"},
    {key: "online", label: "Online Evaluations"},
    {key: "custom", label: "SDK Evaluations"},
]

const POC_TAB_COLOR_MAP: Record<AppTabKey, string> = {
    all: "#e0f2fe",
    auto: "#dbeafe",
    human: "#ede9fe",
    online: "#dcfce7",
    custom: "#fce7f3",
    human_ab_testing: "#fef3f7",
}

interface EvaluationTabsProps {
    scope: EvaluationScope
    tabItems: {key: AppTabKey; label: string}[]
    tabColorMap: Record<AppTabKey, string>
    includeAbTesting: boolean
    useRouteAppId: boolean
}

const EvaluationTabs = ({
    scope,
    tabItems,
    tabColorMap,
    includeAbTesting,
    useRouteAppId,
}: EvaluationTabsProps) => {
    const router = useRouter()
    const projectId = useAtomValue(projectIdAtom)
    const setEvaluationTypeFilters = useSetAtom(evaluationRunsTypeFiltersAtom)
    const setTableOverrides = useSetAtom(evaluationRunsTableContextSetterAtom)
    const routeAppId = useAppId()
    const determineAppId = useMemo(
        () => (useRouteAppId ? (routeAppId ?? null) : null),
        [routeAppId, useRouteAppId],
    )
    const [kindParam, setKindParam] = useQueryParamState("kind", "auto")
    const [isPending, startTransition] = useTransition()
    const [displayedTab, setDisplayedTab] = useState<AppTabKey>(
        ((Array.isArray(kindParam) ? kindParam[0] : kindParam) as AppTabKey) ?? "auto",
    )
    const [isNavigatingAway, setIsNavigatingAway] = useState(false)
    const lastOverridesRef = useRef<{
        appId: string | null
        projectIdOverride: string | null
        includePreview: boolean
        evaluationKind: EvaluationRunKind
    } | null>(null)

    const activeTab = useMemo<AppTabKey>(() => {
        const value = Array.isArray(kindParam) ? kindParam[0] : kindParam
        return (value as AppTabKey) ?? "auto"
    }, [kindParam])

    useEffect(() => {
        if (activeTab === displayedTab || isPending) return
        const handle = window.setTimeout(
            () => setDisplayedTab(activeTab),
            TAB_CONTENT_SWITCH_DELAY_MS,
        )
        return () => window.clearTimeout(handle)
    }, [activeTab, displayedTab, isPending])

    const displayedRunKind =
        displayedTab === "human_ab_testing" ? null : (displayedTab as EvaluationRunKind)

    useEffect(() => {
        if (!displayedRunKind) return
        if (displayedRunKind === "all") {
            setEvaluationTypeFilters([])
        } else {
            setEvaluationTypeFilters([displayedRunKind as ConcreteEvaluationRunKind])
        }
    }, [displayedRunKind, setEvaluationTypeFilters])

    useEffect(() => {
        if (!displayedRunKind || isNavigatingAway) return
        const next = {
            appId: determineAppId,
            projectIdOverride: projectId ?? null,
            includePreview: true,
            evaluationKind: displayedRunKind,
            scope,
        }
        const prev = lastOverridesRef.current
        if (
            prev &&
            prev.appId === next.appId &&
            prev.projectIdOverride === next.projectIdOverride &&
            prev.includePreview === next.includePreview &&
            prev.evaluationKind === next.evaluationKind
        ) {
            return
        }
        lastOverridesRef.current = next
        setTableOverrides(next)
    }, [displayedRunKind, projectId, determineAppId, scope, setTableOverrides, isNavigatingAway])

    useEffect(() => {
        const handleStart = (url: string) => {
            if (!url.includes("/evaluations")) {
                setIsNavigatingAway(true)
            }
        }
        const handleFinish = (url: string) => {
            setIsNavigatingAway(!url?.includes?.("/evaluations"))
        }
        router.events.on("routeChangeStart", handleStart)
        router.events.on("routeChangeComplete", handleFinish)
        router.events.on("routeChangeError", handleFinish)
        return () => {
            router.events.off("routeChangeStart", handleStart)
            router.events.off("routeChangeComplete", handleFinish)
            router.events.off("routeChangeError", handleFinish)
        }
    }, [router.events])

    const tabLabel = useMemo(
        () => tabItems.find((item) => item.key === displayedTab)?.label ?? "Evaluations",
        [displayedTab, tabItems],
    )

    useBreadcrumbsEffect(
        {
            breadcrumbs: {appPage: {label: tabLabel}},
            type: "append",
            condition: true,
        },
        [tabLabel, router.asPath],
    )

    const renderContent = useMemo(() => {
        if (includeAbTesting && displayedTab === "human_ab_testing") {
            return <AbTestingEvaluation viewType="evaluation" />
        }
        if (!displayedRunKind) return null
        return (
            <div className="grow flex flex-col min-h-0">
                <EvaluationRunsTablePOC
                    includePreview
                    pageSize={15}
                    projectIdOverride={projectId ?? undefined}
                    evaluationKind={displayedRunKind}
                    className="flex-1 min-h-0"
                />
            </div>
        )
    }, [displayedTab, displayedRunKind, projectId, includeAbTesting])

    return (
        <>
            <div
                className={clsx(
                    "flex min-h-0 flex-col gap-6 h-[calc(100dvh-75px-24px)] overflow-hidden -mt-6 -mb-6",
                )}
            >
                <div className="mt-4 w-full flex items-start justify-between gap-8">
                    <div className="flex flex-col gap-1 min-w-[200px] max-w-prose shrink">
                        <Typography.Title level={3} style={{margin: 0}}>
                            Evaluations
                        </Typography.Title>
                        <Typography.Paragraph type="secondary" style={{marginBottom: 0}}>
                            Manage all your evaluations in one place.
                        </Typography.Paragraph>
                    </div>

                    <div className="min-w-0 shrink grow flex justify-end">
                        <div className="flex flex-col items-end gap-1">
                            <div
                                className="evaluations-tabs min-w-[320px] flex-1"
                                style={
                                    {
                                        "--tab-indicator-color":
                                            tabColorMap[displayedTab] ?? "#dbeafe",
                                    } as CSSProperties
                                }
                            >
                                <Tabs
                                    className="min-w-[320px] flex-1"
                                    activeKey={activeTab}
                                    items={tabItems.map((item) => ({
                                        key: item.key,
                                        label: item.label,
                                    }))}
                                    onChange={(key) => {
                                        startTransition(() => {
                                            setKindParam(key)
                                        })
                                    }}
                                    destroyOnHidden
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {renderContent}
            </div>
        </>
    )
}

interface EvaluationsViewProps {
    scope?: EvaluationScope
}

const EvaluationsView = ({scope = "app"}: EvaluationsViewProps) => {
    if (scope === "project") {
        return (
            <EvaluationTabs
                scope="project"
                tabItems={POC_TAB_ITEMS}
                tabColorMap={POC_TAB_COLOR_MAP as Record<AppTabKey, string>}
                includeAbTesting={false}
                useRouteAppId={false}
            />
        )
    }
    return (
        <EvaluationTabs
            scope="app"
            tabItems={APP_TAB_ITEMS}
            tabColorMap={APP_TAB_COLOR_MAP}
            includeAbTesting={true}
            useRouteAppId={true}
        />
    )
}

export default memo(EvaluationsView)
