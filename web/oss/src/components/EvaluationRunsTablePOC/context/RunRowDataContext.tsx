import {createContext, useContext, useMemo, useRef, type ReactNode} from "react"

import {useAtomValue} from "jotai"
import {IMMEDIATE_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {evaluationRunsProjectIdAtom} from "../atoms/view"
import usePreviewRunDetails from "../hooks/usePreviewRunDetails"
import usePreviewRunSummary from "../hooks/usePreviewRunSummary"
import type {EvaluationRunTableRow} from "../types"
import {buildReferenceSequence, type ReferenceSlot} from "../utils/referenceSchema"

interface RunRowDataContextValue {
    record: EvaluationRunTableRow
    summary: ReturnType<typeof usePreviewRunSummary>["summary"]
    summaryLoading: boolean
    testsetNames: ReturnType<typeof usePreviewRunSummary>["testsetNames"]
    stepReferences: ReturnType<typeof usePreviewRunSummary>["stepReferences"]
    camelRun: ReturnType<typeof usePreviewRunDetails>["camelRun"]
    runIndex: ReturnType<typeof usePreviewRunDetails>["runIndex"]
    status: ReturnType<typeof usePreviewRunDetails>["status"]
    detailsLoading: boolean
    referenceSequence: ReferenceSlot[]
}

const RunRowDataContext = createContext<RunRowDataContextValue | null>(null)
const runRowDataCache = new Map<string, RunRowDataContextValue>()
const getRunKey = (record: EvaluationRunTableRow) => record.preview?.id ?? record.runId
const isCachedRowDataEqual = (
    prev: RunRowDataContextValue | undefined,
    next: RunRowDataContextValue,
) => {
    if (!prev) return false
    return (
        prev.record.key === next.record.key &&
        prev.summary === next.summary &&
        prev.summaryLoading === next.summaryLoading &&
        prev.camelRun === next.camelRun &&
        prev.runIndex === next.runIndex &&
        prev.status === next.status &&
        prev.detailsLoading === next.detailsLoading &&
        prev.testsetNames === next.testsetNames &&
        prev.stepReferences === next.stepReferences &&
        prev.referenceSequence === next.referenceSequence
    )
}

export const RunRowDataProvider = ({
    record,
    children,
}: {
    record: EvaluationRunTableRow
    children: ReactNode
}) => {
    const cacheKey = getRunKey(record)
    const lastContextRef = useRef<RunRowDataContextValue | null>(null)

    if (typeof window !== "undefined") {
        console.debug("[RunRowDataProvider] mount", {
            key: record.key,
            projectId: record.projectId,
            runId: record.runId,
            previewId: record.preview?.id,
            source: record.source,
            isSkeleton: record.__isSkeleton,
        })
    }
    const contextProjectId = useAtomValue(evaluationRunsProjectIdAtom)
    // useAtomValueWithSchedule(evaluationRunsProjectIdAtom, {
    //     priority: IMMEDIATE_PRIORITY,
    // })
    const runId = record.preview?.id ?? record.runId
    const projectId = record.projectId ?? contextProjectId ?? null
    const canFetch = Boolean(!record.__isSkeleton && runId && projectId)

    const {
        summary,
        testsetNames,
        stepReferences,
        isLoading: summaryLoading,
    } = usePreviewRunSummary(
        {
            projectId,
            runId,
        },
        {enabled: canFetch},
    )

    const {
        camelRun,
        runIndex,
        status,
        isLoading: detailsLoading,
    } = usePreviewRunDetails(runId, {enabled: canFetch})
    const referenceSequence = useMemo(
        () => buildReferenceSequence(record.previewMeta),
        [record.previewMeta],
    )

    const contextValue = useMemo(() => {
        const nextValue: RunRowDataContextValue = {
            record,
            summary,
            summaryLoading,
            testsetNames,
            stepReferences,
            camelRun,
            runIndex,
            status,
            detailsLoading,
            referenceSequence,
        }
        if (cacheKey && isCachedRowDataEqual(runRowDataCache.get(cacheKey), nextValue)) {
            return runRowDataCache.get(cacheKey) as RunRowDataContextValue
        }
        if (cacheKey) {
            runRowDataCache.set(cacheKey, nextValue)
        }
        lastContextRef.current = nextValue
        return nextValue
    }, [
        cacheKey,
        record,
        summary,
        summaryLoading,
        testsetNames,
        stepReferences,
        camelRun,
        runIndex,
        status,
        detailsLoading,
        referenceSequence,
    ])

    if (typeof window !== "undefined" && !summaryLoading && summary) {
        console.debug("[RunRowDataProvider] summary ready", {
            key: record.key,
            summary,
        })
    }

    return <RunRowDataContext.Provider value={contextValue}>{children}</RunRowDataContext.Provider>
}

const useRunRowDataContext = () => {
    const context = useContext(RunRowDataContext)
    return context
}

export const useRunRowSummary = (record?: EvaluationRunTableRow, isVisible = true) => {
    const context = useRunRowDataContext()
    const runId = record?.preview?.id ?? record?.runId ?? null
    const projectId = record?.projectId ?? null
    const enabled = Boolean(
        record && !record.__isSkeleton && runId && projectId && isVisible && !context,
    )
    const {summary, isLoading, testsetNames, stepReferences} = usePreviewRunSummary(
        {projectId, runId},
        {enabled},
    )

    if (context) {
        const {
            summary: ctxSummary,
            summaryLoading,
            testsetNames: ctxTestsets,
            stepReferences: ctxRefs,
        } = context
        return {
            summary: ctxSummary,
            isLoading: summaryLoading,
            testsetNames: ctxTestsets,
            stepReferences: ctxRefs,
        }
    }

    return {summary, isLoading, testsetNames, stepReferences}
}

export const useRunRowDetails = (record?: EvaluationRunTableRow, _isVisible = true) => {
    const context = useRunRowDataContext()
    const runId = record?.preview?.id ?? record?.runId ?? null
    const enabled = Boolean(record && !record.__isSkeleton && runId && !context)
    const {camelRun, runIndex, status, isLoading} = usePreviewRunDetails(runId, {enabled})

    if (context) {
        const {camelRun: ctxRun, runIndex: ctxIndex, status: ctxStatus, detailsLoading} = context
        return {camelRun: ctxRun, runIndex: ctxIndex, status: ctxStatus, isLoading: detailsLoading}
    }

    return {camelRun, runIndex, status, isLoading}
}

export const useRunRowRecord = () => {
    const context = useRunRowDataContext()
    if (context) {
        return context.record
    }
    return null
}

export const useRunRowReferences = (record?: EvaluationRunTableRow) => {
    const context = useRunRowDataContext()
    if (context) {
        return context.referenceSequence
    }
    return buildReferenceSequence(record?.previewMeta ?? null)
}
