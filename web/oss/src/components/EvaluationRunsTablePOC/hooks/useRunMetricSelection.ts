import {useEffect, useMemo, useRef} from "react"

import {atom, useAtomValue} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    previewRunMetricStatsSelectorFamily,
    type RunLevelMetricSelection,
} from "@/oss/components/evaluations/atoms/runMetrics"

const idleMetricSelectionAtom = atom<RunLevelMetricSelection>({
    state: "loading",
})

interface UseRunMetricSelectionArgs {
    runId: string | null | undefined
    metricKey?: string
    metricPath?: string
    stepKey?: string
}

interface UseRunMetricSelectionOptions {
    enabled?: boolean
    debugLabel?: string
}

export const useRunMetricSelection = (
    {runId, metricKey, metricPath, stepKey}: UseRunMetricSelectionArgs,
    {enabled = true, debugLabel}: UseRunMetricSelectionOptions = {},
) => {
    const debugEnabled =
        Boolean(debugLabel) &&
        process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true" &&
        typeof window !== "undefined"

    const metricAtom = useMemo(() => {
        if (!enabled || !runId) {
            return idleMetricSelectionAtom
        }
        return previewRunMetricStatsSelectorFamily({
            runId,
            metricKey,
            metricPath,
            stepKey,
            includeTemporal: false,
        })
    }, [enabled, runId, metricKey, metricPath, stepKey])

    const lastSelectionRef = useRef<RunLevelMetricSelection>({state: "loading"})
    const selection = useAtomValue(metricAtom)
    // useAtomValueWithSchedule(metricAtom, {priority: LOW_PRIORITY})

    useEffect(() => {
        if (!enabled) return
        if (!selection) return
        lastSelectionRef.current = selection
    }, [debugEnabled, debugLabel, enabled, selection])

    useEffect(() => {
        if (!runId) {
            lastSelectionRef.current = {state: "hasData", stats: undefined, resolvedKey: undefined}
        } else {
            lastSelectionRef.current = {state: "loading"}
        }
    }, [runId, metricKey, metricPath, stepKey])

    if (!enabled) {
        return lastSelectionRef.current
    }

    return selection ?? {state: "loading"}
}

export default useRunMetricSelection
