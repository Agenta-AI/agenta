import {memo, useMemo, useState} from "react"

import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
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
    const [open, setOpen] = useState(false)
    const style = useMemo(() => buildAccentStyle(accentColor), [accentColor])
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
                <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="min-w-0 flex-1">
                        <span className="truncate block font-semibold" title={label || runId}>
                            {label || runId}
                        </span>
                    </div>
                    <span className="text-muted-foreground">Run details</span>
                </div>
                {isLoading ? (
                    <div className="flex flex-col gap-2">
                        <Skeleton className="h-6 w-40 !w-full" />
                        <Skeleton className="h-6 w-40 !w-full" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Run ID</span>
                            <ReferenceTag
                                label={shortRunId}
                                tooltip={runId}
                                copyValue={runId}
                                showIcon={false}
                                className="max-w-[200px]"
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Application</span>
                            <ApplicationReferenceLabel
                                runId={runId}
                                applicationId={invocationRefs?.applicationId}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Variant</span>
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
                            <span className="text-muted-foreground">Test sets</span>
                            <TestsetTagList
                                ids={testsetIds}
                                runId={runId}
                                className="justify-end"
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Created</span>
                            <span>{formatDateTime(createdAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Updated</span>
                            <span>{formatDateTime(updatedAt)}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <Popover
            open={open}
            onOpenChange={(nextOpen, eventDetails) => {
                if (eventDetails.reason === "trigger-press") return
                setOpen(nextOpen)
            }}
        >
            <PopoverTrigger
                nativeButton={false}
                openOnHover
                delay={200}
                render={
                    <ReferenceTag
                        label={label || runId}
                        showIcon={false}
                        copyValue={runId}
                        style={style}
                    />
                }
            />
            <PopoverContent side="top" align="center">
                {popoverContent}
            </PopoverContent>
        </Popover>
    )
}

export default memo(RunNameTag)
