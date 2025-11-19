import {useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {evaluationRunQueryAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/table/run"

const idleRunQueryAtom = atom({
    data: null,
    isLoading: false,
    isFetching: false,
    isPending: false,
})

interface UsePreviewRunDetailsOptions {
    enabled?: boolean
}

export const usePreviewRunDetails = (
    runId: string | null | undefined,
    options?: UsePreviewRunDetailsOptions,
) => {
    console.log("usePreviewRunDetails")
    const enabled = options?.enabled ?? true
    const queryAtom = useMemo(() => {
        if (!enabled || !runId) return idleRunQueryAtom
        return evaluationRunQueryAtomFamily(runId)
    }, [enabled, runId])

    const queryResult = useAtomValueWithSchedule(queryAtom, {priority: LOW_PRIORITY})
    const data = enabled && runId ? (queryResult?.data ?? null) : null
    const hasData = Boolean(data)
    const camelRun = data?.camelRun ?? data?.rawRun ?? null
    const runIndex = data?.runIndex ?? null

    const status = useMemo(() => {
        if (!camelRun) return undefined
        const rawStatus = (camelRun as any)?.status
        if (typeof rawStatus === "string") return rawStatus
        if (typeof rawStatus?.value === "string") return rawStatus.value
        return undefined
    }, [camelRun])

    const isLoading =
        Boolean(enabled && runId) &&
        !hasData &&
        Boolean(queryResult?.isLoading || queryResult?.isFetching || queryResult?.isPending)

    return {camelRun, runIndex, status, isLoading}
}

export default usePreviewRunDetails
