import {memo, useMemo} from "react"

import {Popover, Skeleton, Typography} from "antd"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import ReferenceTag from "@/oss/components/References/ReferenceTag"

import {
    runCreatedAtAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
    runUpdatedAtAtomFamily,
} from "../../../../atoms/runDerived"
import {evaluationRunQueryAtomFamily} from "../../../../atoms/table/run"
import {ApplicationReferenceLabel, TestsetTagList, VariantRevisionLabel} from "../../../references"

interface RunNameTagProps {
    runId: string
    label: string
    accentColor?: string | null
}

const parseHex = (hex?: string | null) => {
    if (!hex) return null
    const normalized = hex.replace("#", "")
    const expanded =
        normalized.length === 3
            ? normalized
                  .split("")
                  .map((char) => char + char)
                  .join("")
            : normalized
    if (expanded.length !== 6) return null
    const r = Number.parseInt(expanded.slice(0, 2), 16)
    const g = Number.parseInt(expanded.slice(2, 4), 16)
    const b = Number.parseInt(expanded.slice(4, 6), 16)
    if ([r, g, b].some((value) => Number.isNaN(value))) return null
    return {r, g, b}
}

const buildAccentStyle = (accentColor?: string | null) => {
    const rgb = parseHex(accentColor)
    if (!rgb || !accentColor) return undefined
    return {
        color: accentColor,
        backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`,
        borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
    }
}

const formatDateTime = (value: string | number | Date | null | undefined) => {
    if (!value) return "—"
    try {
        return new Date(value).toLocaleString()
    } catch {
        return "—"
    }
}

const RunNameTag = ({runId, label, accentColor}: RunNameTagProps) => {
    const style = useMemo(() => buildAccentStyle(accentColor), [accentColor])
    const tooltip = useMemo(() => {
        if (!label) return runId
        if (label === runId) return label
        return `${label} (${runId})`
    }, [label, runId])

    const runQuery = useAtomValueWithSchedule(
        useMemo(() => evaluationRunQueryAtomFamily(runId), [runId]),
        {priority: LOW_PRIORITY},
    )
    const isLoading = runQuery?.isPending && !runQuery?.data

    const invocationRefs = useAtomValueWithSchedule(
        useMemo(() => runInvocationRefsAtomFamily(runId), [runId]),
        {priority: LOW_PRIORITY},
    )
    const testsetIds =
        useAtomValueWithSchedule(
            useMemo(() => runTestsetIdsAtomFamily(runId), [runId]),
            {priority: LOW_PRIORITY},
        ) ?? []
    const createdAt = useAtomValueWithSchedule(
        useMemo(() => runCreatedAtAtomFamily(runId), [runId]),
        {priority: LOW_PRIORITY},
    )
    const updatedAt = useAtomValueWithSchedule(
        useMemo(() => runUpdatedAtAtomFamily(runId), [runId]),
        {priority: LOW_PRIORITY},
    )

    const shortRunId = useMemo(() => {
        const parts = runId?.split?.("-") ?? []
        return parts.length > 1 ? parts[parts.length - 1] : runId
    }, [runId])

    const popoverContent = (
        <div className="min-w-[280px] max-w-[340px]">
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                    <Typography.Text strong className="truncate">
                        {label || runId}
                    </Typography.Text>
                    <Typography.Text type="secondary">Run details</Typography.Text>
                </div>
                {isLoading ? (
                    <div className="flex flex-col gap-2">
                        <Skeleton.Input active size="small" className="!w-full" />
                        <Skeleton.Input active size="small" className="!w-full" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                            <Typography.Text type="secondary">Run ID</Typography.Text>
                            <ReferenceTag
                                label={shortRunId}
                                tooltip={runId}
                                copyValue={runId}
                                showIcon={false}
                                className="max-w-[200px]"
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <Typography.Text type="secondary">Application</Typography.Text>
                            <ApplicationReferenceLabel
                                runId={runId}
                                applicationId={invocationRefs?.applicationId}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <Typography.Text type="secondary">Variant</Typography.Text>
                            <VariantRevisionLabel
                                runId={runId}
                                variantId={
                                    invocationRefs?.variantId ??
                                    invocationRefs?.applicationVariantId
                                }
                                applicationId={invocationRefs?.applicationId}
                            />
                        </div>
                        <div className="flex items-start justify-between gap-3">
                            <Typography.Text type="secondary">Test sets</Typography.Text>
                            <TestsetTagList
                                ids={testsetIds}
                                runId={runId}
                                className="justify-end"
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <Typography.Text type="secondary">Created</Typography.Text>
                            <Typography.Text>{formatDateTime(createdAt)}</Typography.Text>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <Typography.Text type="secondary">Updated</Typography.Text>
                            <Typography.Text>{formatDateTime(updatedAt)}</Typography.Text>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <Popover mouseEnterDelay={0.2} arrow content={popoverContent}>
            <ReferenceTag
                label={label || runId}
                showIcon={false}
                copyValue={runId}
                tooltip={tooltip}
                style={style}
            />
        </Popover>
    )
}

export default memo(RunNameTag)
