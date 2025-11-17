import {useTransition, useMemo, useEffect, useRef, useState, memo, type CSSProperties} from "react"

import {Tabs, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {
    EvaluationRunsTablePOC,
    type EvaluationRunKind,
    type ConcreteEvaluationRunKind,
} from "@/oss/components/EvaluationRunsTablePOC"
import {evaluationRunsTableContextSetterAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/context"
import {evaluationRunsTypeFiltersAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/view"
import {useQueryParamState} from "@/oss/state/appState"
import {projectIdAtom} from "@/oss/state/project"

import {tabItems, tabColorMap} from "./assets/constants"

const TAB_CONTENT_SWITCH_DELAY_MS = 220

const EvaluationsViewPOC = () => {
    const [kindParam, setKindParam] = useQueryParamState("kind", "auto")
    const [isPending, startTransition] = useTransition()
    const activeTab = useMemo(() => {
        const raw = Array.isArray(kindParam) ? kindParam[0] : kindParam
        return (raw as EvaluationRunKind) ?? "auto"
    }, [kindParam])
    const [displayedTab, setDisplayedTab] = useState<EvaluationRunKind>(activeTab)
    const projectId = useAtomValue(projectIdAtom)
    const setTableOverrides = useSetAtom(evaluationRunsTableContextSetterAtom)
    const router = useRouter()
    const [isNavigatingAway, setIsNavigatingAway] = useState(false)
    const setEvaluationTypeFilters = useSetAtom(evaluationRunsTypeFiltersAtom)
    const lastOverridesRef = useRef<{
        appId: string | null
        projectIdOverride: string | null
        includePreview: boolean
        evaluationKind: EvaluationRunKind
    } | null>(null)

    useEffect(() => {
        if (activeTab === displayedTab) {
            return
        }
        if (isPending) {
            return
        }
        const handle = window.setTimeout(() => {
            setDisplayedTab(activeTab)
        }, TAB_CONTENT_SWITCH_DELAY_MS)
        return () => {
            window.clearTimeout(handle)
        }
    }, [activeTab, displayedTab, isPending])

    useEffect(() => {
        const next = {
            appId: null,
            projectIdOverride: projectId ?? null,
            includePreview: true,
            evaluationKind: displayedTab,
            scope: "project" as const,
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
        if (isNavigatingAway) {
            return
        }
        lastOverridesRef.current = next
        setTableOverrides(next)
    }, [displayedTab, projectId, setTableOverrides, isNavigatingAway])

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

    useEffect(() => {
        if (displayedTab === "all") {
            setEvaluationTypeFilters([])
        } else {
            setEvaluationTypeFilters([displayedTab as ConcreteEvaluationRunKind])
        }
    }, [displayedTab, setEvaluationTypeFilters])

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
                                            tabColorMap[activeTab] ?? "#dbeafe",
                                    } as CSSProperties
                                }
                            >
                                <Tabs
                                    className="min-w-[320px] flex-1"
                                    activeKey={activeTab}
                                    items={tabItems}
                                    onChange={(key) => {
                                        startTransition(() => {
                                            setKindParam(key)
                                        })
                                    }}
                                    destroyOnHidden
                                />
                            </div>
                            {/* {pendingTabSwitch ? (
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <Spin size="small" />
                                <span>Loading {pendingLabel}…</span>
                            </div>
                        ) : null} */}
                        </div>
                    </div>
                </div>

                <div className="flex flex-1 min-h-0 flex-col">
                    <EvaluationRunsTablePOC
                        includePreview
                        pageSize={15}
                        projectIdOverride={projectId ?? undefined}
                        evaluationKind={displayedTab}
                        className="flex-1 min-h-0"
                    />
                </div>
            </div>
        </>
    )
}

export default memo(EvaluationsViewPOC)
