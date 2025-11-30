import {memo, useMemo} from "react"

import {Space, Tabs, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {VariantReferenceChip, TestsetReferenceChip} from "@/oss/components/References"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"

import {runInvocationRefsAtomFamily, runTestsetIdsAtomFamily} from "../atoms/runDerived"
import {evaluationRunQueryAtomFamily} from "../atoms/table"
import {previewEvalTypeAtom} from "../state/evalType"

import CompareRunsMenu from "./CompareRunsMenu"

const statusColor = (status?: string | null) => {
    if (!status) return "default"
    const normalized = status.toLowerCase()
    if (normalized.includes("success") || normalized.includes("completed")) return "green"
    if (normalized.includes("fail") || normalized.includes("error")) return "red"
    if (normalized.includes("running") || normalized.includes("queued")) return "blue"
    return "default"
}

type ActiveView = "overview" | "focus" | "scenarios" | "configuration"

const PreviewEvalRunHeader = ({
    runId,
    className,
    activeView,
    onChangeView,
}: {
    runId: string
    className?: string
    activeView?: ActiveView
    onChangeView?: (v: ActiveView) => void
}) => {
    const runQueryAtom = useMemo(() => evaluationRunQueryAtomFamily(runId), [runId])
    const runQuery = useAtomValue(runQueryAtom)
    const invocationRefs = useAtomValue(useMemo(() => runInvocationRefsAtomFamily(runId), [runId]))
    const testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId), [runId]))
    const evalType = useAtomValue(previewEvalTypeAtom)

    const runData = runQuery.data?.camelRun ?? runQuery.data?.rawRun ?? null
    const runStatus = runData?.status ?? null
    const updatedTs =
        (runData as any)?.updatedAt ||
        (runData as any)?.updated_at ||
        (runData as any)?.createdAt ||
        (runData as any)?.created_at ||
        null
    const updatedMoment = updatedTs ? dayjs(updatedTs) : null
    const lastUpdated = updatedMoment?.isValid() ? updatedMoment.fromNow() : undefined

    const statusDotClass = (() => {
        const lower = (runStatus || "").toLowerCase()
        if (
            lower.includes("run") ||
            lower.includes("progress") ||
            lower.includes("active") ||
            lower.includes("running") ||
            lower.includes("queued")
        ) {
            return "bg-green-500"
        }
        if (lower.includes("completed") || lower.includes("closed") || lower.includes("success")) {
            return "bg-gray-400"
        }
        if (lower.includes("stopped") || lower.includes("error") || lower.includes("fail")) {
            return "bg-red-500"
        }
        return "bg-yellow-500"
    })()

    const tabs = useMemo(() => {
        const base: {label: string; value: ActiveView}[] = [
            {label: "Overview", value: "overview"},
            {label: "Scenarios", value: "scenarios"},
            {label: "Configuration", value: "configuration"},
        ]

        if (evalType === "human") {
            base.splice(1, 0, {label: "Focus", value: "focus"})
        }

        return base
    }, [evalType])

    const currentView = activeView ?? tabs[0]?.value ?? "overview"

    return (
        <div
            className={clsx(
                "w-full",
                "flex items-center justify-between gap-4 p-2 sticky top-0 z-[11] bg-white",
                currentView === "overview" && "border-0",
                className,
            )}
        >
            <div className={clsx("flex min-w-0 items-center gap-6")}>
                <Tabs
                    className="run-header-tabs [&_.ant-tabs-nav]:mb-0"
                    activeKey={currentView}
                    onChange={(key) => {
                        const view = key as ActiveView
                        if (view !== currentView) {
                            onChangeView?.(view)
                        }
                    }}
                    items={tabs.map((tab) => ({
                        key: tab.value,
                        label: tab.label,
                    }))}
                />
            </div>
            <div className="flex items-center gap-3 shrink-0">
                <Space size={8} wrap className="text-[#475467]">
                    {runStatus ? (
                        <>
                            <span
                                className={clsx(
                                    "shrink-0 inline-block w-2 h-2 rounded-full",
                                    statusDotClass,
                                )}
                            />
                            <Tag color={statusColor(runStatus)} className="m-0">
                                {runStatus}
                            </Tag>
                            {lastUpdated ? (
                                <Tooltip title={updatedMoment?.format("DD MMM YYYY HH:mm") ?? ""}>
                                    <span className="text-xs text-[#98A2B3] whitespace-nowrap">
                                        Updated {lastUpdated}
                                    </span>
                                </Tooltip>
                            ) : null}
                        </>
                    ) : null}
                </Space>
                <CompareRunsMenu runId={runId} />
            </div>
        </div>
    )
}

export default memo(PreviewEvalRunHeader)
