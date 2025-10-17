import {FC, memo, useCallback, useMemo} from "react"

import {Typography} from "antd"
import {atom, useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {
    loadableScenarioStepFamily,
    bulkStepsCacheFamily,
    getCurrentRunId,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {renderSkeleton} from "./assets/utils"
import InvocationRun from "./InvocationRun"

interface EvalRunScenarioCardBodyProps {
    scenarioId: string
    runId?: string
}

const EvalRunScenarioCardBody: FC<EvalRunScenarioCardBodyProps> = ({scenarioId, runId}) => {
    // Get effective runId - use provided runId or fallback to current run context
    const effectiveRunId = useMemo(() => {
        if (runId) return runId
        try {
            return getCurrentRunId()
        } catch (error) {
            return ""
        }
    }, [runId])

    /* --- atoms & data --- */
    // Unified data access that prioritizes bulk cache over individual scenario atoms
    // This ensures we get data from whichever source is available
    const invocationSteps = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    // First try bulk cache (populated by worker)
                    const bulkCache = get(bulkStepsCacheFamily(effectiveRunId))
                    const bulkData = bulkCache?.get(scenarioId)
                    if (
                        bulkCache &&
                        bulkData?.state === "hasData" &&
                        bulkData.data?.invocationSteps
                    ) {
                        return bulkData.data.invocationSteps as any[]
                    }

                    // Fallback to individual scenario atom
                    const loadable = get(
                        loadableScenarioStepFamily({scenarioId, runId: effectiveRunId}),
                    )
                    if (loadable.state === "hasData" && loadable.data?.invocationSteps) {
                        return loadable.data.invocationSteps as any[]
                    }

                    return []
                }),
            [scenarioId, effectiveRunId],
        ),
    )

    // Use the same atom for load state as we use for data to ensure consistency
    // This prevents blocking UI when we have optimistically updated data
    const loadState = useAtomValue(
        useMemo(
            () =>
                selectAtom(loadableScenarioStepFamily({scenarioId, runId: effectiveRunId}), (l) => {
                    return l.state
                }),
            [scenarioId, effectiveRunId],
        ),
    )

    /* --- render content --- */
    const renderRuns = useCallback(() => {
        if (!invocationSteps.length) return null

        return invocationSteps.map((invStep: any) => (
            <InvocationRun
                key={invStep.id}
                invStep={invStep}
                scenarioId={scenarioId}
                runId={effectiveRunId}
            />
        ))
    }, [scenarioId, invocationSteps, effectiveRunId])

    /* --- loading / error states --- */
    // Determine if we truly have no cached data for this scenario yet
    const hasCachedSteps = useAtomValue(
        useMemo(
            () =>
                selectAtom(
                    loadableScenarioStepFamily({scenarioId, runId: effectiveRunId}),
                    (l) => l.state === "hasData" && l.data !== undefined,
                ),
            [scenarioId, effectiveRunId],
        ),
    )

    // Check scenario status to determine if we're in execution/revalidation state
    const scenarioStatus = useAtomValue(
        useMemo(
            () =>
                selectAtom(loadableScenarioStepFamily({scenarioId, runId: effectiveRunId}), (l) => {
                    if (l.state !== "hasData" || !l.data) return null
                    const invSteps = l.data.invocationSteps || []
                    const annSteps = l.data.annotationSteps || []
                    const inputSteps = l.data.inputSteps || []

                    // Check if any step is running or revalidating
                    const isRunning = [...invSteps, ...annSteps, ...inputSteps].some(
                        (s: any) => s.status === "running" || s.status === "revalidating",
                    )

                    return isRunning ? "active" : "idle"
                }),
            [scenarioId, effectiveRunId],
        ),
    )

    // Only show loading skeleton when we're actually fetching data from server AND have no cached data
    // Don't show loading during scenario execution ("running") or revalidation ("revalidating")
    const isInitialLoading =
        loadState === "loading" &&
        !hasCachedSteps &&
        invocationSteps.length === 0 &&
        scenarioStatus !== "active"

    if (isInitialLoading) {
        return renderSkeleton()
    }
    if (loadState === "hasError") {
        return <Typography.Text type="danger">Failed to load scenario data.</Typography.Text>
    }

    if (!invocationSteps.length) return null

    return <div className="flex flex-col gap-6 w-full">{renderRuns()}</div>
}

export default memo(EvalRunScenarioCardBody)
