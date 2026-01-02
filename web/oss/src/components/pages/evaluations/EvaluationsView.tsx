import {
    memo,
    useEffect,
    useMemo,
    useRef,
    useState,
    useTransition,
    type CSSProperties,
    type ReactNode,
} from "react"

import {CloudServerOutlined} from "@ant-design/icons"
import {ChartDonutIcon, CodeIcon, ListChecksIcon} from "@phosphor-icons/react"
import type {TabsProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {
    EvaluationRunsTablePOC,
    type EvaluationRunKind,
} from "@/oss/components/EvaluationRunsTablePOC"
import {evaluationRunsTableContextSetterAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/context"
import {evaluationRunsTypeFiltersAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/view"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {useQueryParamState} from "@/oss/state/appState"
import {projectIdAtom} from "@/oss/state/project"

import {ConcreteEvaluationRunKind} from "../../EvaluationRunsTablePOC/types"
import PageLayout from "../../PageLayout/PageLayout"

type EvaluationScope = "app" | "project"
type AppTabKey = EvaluationRunKind

const TAB_CONTENT_SWITCH_DELAY_MS = 220

const PROJECT_TAB_ITEMS: {key: AppTabKey; label: string}[] = [
    {key: "all", label: "All Evals"},
    {key: "auto", label: "Auto Evals"},
    {key: "human", label: "Human Evals"},
    {key: "online", label: "Online Evals"},
    {key: "custom", label: "SDK Evals"},
]

const APP_TAB_ITEMS: {key: AppTabKey; label: string}[] = [
    {key: "all", label: "All Evals"},
    {key: "auto", label: "Auto Evals"},
    {key: "human", label: "Human Evals"},
    {key: "custom", label: "SDK Evals"},
]

const TAB_COLOR_MAP: Record<AppTabKey, string> = {
    all: "#e0f2fe",
    auto: "#dbeafe",
    human: "#ede9fe",
    online: "#dcfce7",
    custom: "#fce7f3",
}

const TAB_ICON_MAP: Record<AppTabKey, ReactNode> = {
    all: null,
    auto: <ChartDonutIcon />,
    human: <ListChecksIcon />,
    online: <CloudServerOutlined />,
    custom: <CodeIcon />,
}

interface EvaluationTabsProps {
    scope: EvaluationScope
    tabItems: {key: AppTabKey; label: string}[]
    tabColorMap: Record<AppTabKey, string>
    appId?: string
}

const EvaluationTabs = ({scope, tabItems, tabColorMap, appId}: EvaluationTabsProps) => {
    const router = useRouter()
    const projectId = useAtomValue(projectIdAtom)
    const setEvaluationTypeFilters = useSetAtom(evaluationRunsTypeFiltersAtom)
    const setTableOverrides = useSetAtom(evaluationRunsTableContextSetterAtom)
    const [kindParam, setKindParam] = useQueryParamState("kind", "all")
    const [isPending, startTransition] = useTransition()
    const [displayedTab, setDisplayedTab] = useState<AppTabKey>(
        ((Array.isArray(kindParam) ? kindParam[0] : kindParam) as AppTabKey) ?? "all",
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
        return (value as AppTabKey) ?? "all"
    }, [kindParam])

    useEffect(() => {
        if (activeTab === displayedTab || isPending) return
        const handle = window.setTimeout(
            () => setDisplayedTab(activeTab),
            TAB_CONTENT_SWITCH_DELAY_MS,
        )
        return () => window.clearTimeout(handle)
    }, [activeTab, displayedTab, isPending])

    const displayedRunKind = displayedTab as EvaluationRunKind

    useEffect(() => {
        if (displayedRunKind === "all") {
            setEvaluationTypeFilters([])
        } else {
            setEvaluationTypeFilters([displayedRunKind as ConcreteEvaluationRunKind])
        }
    }, [displayedRunKind, setEvaluationTypeFilters])

    useEffect(() => {
        if (isNavigatingAway) return
        const next = {
            appId: appId ?? null,
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
    }, [displayedRunKind, projectId, appId, scope, setTableOverrides, isNavigatingAway])

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

    const tabIndicatorColor = useMemo(
        () => tabColorMap[displayedTab] ?? "#dbeafe",
        [displayedTab, tabColorMap],
    )
    const tabItemsWithIcons = useMemo(
        () =>
            tabItems.map((item) => ({
                key: item.key,
                label: (
                    <span className="inline-flex items-center gap-2">
                        {TAB_ICON_MAP[item.key]}
                        {item.label}
                    </span>
                ),
            })),
        [tabItems],
    )

    const headerTabsProps = useMemo<TabsProps>(
        () => ({
            className: "infinite-table-tabs min-w-[320px] [&_.ant-tabs-nav]:mb-0",
            style: tabIndicatorColor
                ? ({"--tab-indicator-color": tabIndicatorColor} as CSSProperties)
                : undefined,
            activeKey: activeTab,
            items: tabItemsWithIcons,
            onChange: (key) => {
                startTransition(() => {
                    setKindParam(key)
                })
            },
            destroyOnHidden: true,
        }),
        [activeTab, setKindParam, startTransition, tabIndicatorColor, tabItemsWithIcons],
    )

    return (
        <PageLayout
            className="h-full min-h-0"
            title="Evaluations"
            headerTabsProps={headerTabsProps}
        >
            <EvaluationRunsTablePOC
                includePreview
                pageSize={15}
                appId={appId}
                projectIdOverride={projectId ?? undefined}
                evaluationKind={displayedRunKind}
                className="flex-1 min-h-0"
            />
        </PageLayout>
    )
}

interface EvaluationsViewProps {
    scope?: EvaluationScope
    appId?: string
}

const EvaluationsView = ({scope = "app", appId}: EvaluationsViewProps) => {
    const tabItems = scope === "project" ? PROJECT_TAB_ITEMS : APP_TAB_ITEMS

    return (
        <EvaluationTabs
            scope={scope}
            tabItems={tabItems}
            tabColorMap={TAB_COLOR_MAP}
            appId={appId}
        />
    )
}

export default memo(EvaluationsView)
