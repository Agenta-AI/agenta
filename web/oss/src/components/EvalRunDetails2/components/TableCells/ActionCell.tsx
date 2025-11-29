import {memo, useMemo, useCallback} from "react"

import {Spin} from "antd"
import {useAtomValue, getDefaultStore} from "jotai"

import {virtualScenarioTableAnnotateDrawerAtom} from "@/oss/lib/atoms/virtualTable"

import {activePreviewRunIdAtom} from "../../atoms/run"
import {evaluationRunIndexAtomFamily} from "../../atoms/table/run"
import {
    useScenarioInputSteps,
    useScenarioInvocationSteps,
} from "../../hooks/useScenarioStepsSelectors"

import AnnotateActionButton from "./actions/AnnotateActionButton"
import RunActionButton from "./actions/RunActionButton"

const normalizeStatus = (status: string | undefined): string => status?.toLowerCase() ?? ""

// Use global store to communicate with drawer outside the table's isolated Jotai Provider
const globalStore = getDefaultStore()

const PreviewActionCell = ({scenarioId, runId}: {scenarioId?: string; runId?: string}) => {
    const fallbackRunId = useAtomValue(activePreviewRunIdAtom)
    const effectiveRunId = runId ?? fallbackRunId ?? undefined

    const runIndex = useAtomValue(evaluationRunIndexAtomFamily(effectiveRunId ?? null))
    const handleRunClick = useCallback((scenarioId: string, runId?: string, stepKey?: string) => {
        console.info("[EvalRunDetails2] Run scenario action triggered", {
            scenarioId,
            runId,
            stepKey,
        })
    }, [])

    const handleAnnotateClick = useCallback((scenarioId: string, runId?: string) => {
        console.info("[EvalRunDetails2] Annotate action triggered", {scenarioId, runId})
        // Use global store to update the drawer state (table has isolated Jotai Provider)
        globalStore.set(virtualScenarioTableAnnotateDrawerAtom, (prev) => ({
            ...prev,
            open: true,
            scenarioId,
            runId,
            title: "Annotate scenario",
            context: {
                scenarioId,
                runId,
                usePOC: false,
            },
        }))
    }, [])

    const humanInvocationKeys = useMemo(() => {
        if (!runIndex) return []
        return Object.values(runIndex.steps)
            .filter((meta) => meta.kind === "invocation" && meta.origin === "human")
            .map((meta) => meta.key)
    }, [runIndex])

    const humanAnnotationKeys = useMemo(() => {
        if (!runIndex) return []
        return Object.values(runIndex.steps)
            .filter((meta) => meta.kind === "annotation" && meta.origin === "human")
            .map((meta) => meta.key)
    }, [runIndex])

    const inputSelection = useScenarioInputSteps(scenarioId, undefined, effectiveRunId)
    const invocationSelection = useScenarioInvocationSteps(scenarioId, undefined, effectiveRunId)
    const isLoading =
        inputSelection.isLoading ||
        invocationSelection.isLoading ||
        inputSelection.isFetching ||
        invocationSelection.isFetching

    const invocationMap = useMemo(() => {
        const map = new Map<string, string | undefined>()
        invocationSelection.steps.forEach((step) => {
            if (step.stepKey) {
                map.set(step.stepKey, step.status)
            }
        })
        return map
    }, [invocationSelection.steps])

    if (!scenarioId || !effectiveRunId || !runIndex) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-neutral-400">
                —
            </div>
        )
    }

    // Show nothing if no human-origin steps exist (neither invocation nor annotation)
    // This is evaluation-type agnostic - we only care about human-origin steps
    const hasHumanSteps = humanInvocationKeys.length > 0 || humanAnnotationKeys.length > 0
    if (!hasHumanSteps) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-neutral-400">
                —
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Spin size="small" />
            </div>
        )
    }

    // Check if there's a pending human invocation (needs to be run)
    const pendingHumanInvocationStepKey = humanInvocationKeys.find((key) => {
        const status = normalizeStatus(invocationMap.get(key))
        return status !== "success"
    })

    // For annotation to be enabled, ALL invocations must be successful (regardless of origin)
    // This ensures mixed evaluations (automated + human) work correctly
    const allInputsSuccessful =
        inputSelection.steps.length > 0 &&
        inputSelection.steps.every((step) => normalizeStatus(step.status) === "success")

    const allInvocationsSuccessful =
        invocationSelection.steps.length > 0 &&
        invocationSelection.steps.every((step) => normalizeStatus(step.status) === "success")

    // Show annotate button when:
    // 1. Human annotation steps exist in the run index (evaluation-type agnostic)
    // 2. No pending human invocation (if any human invocations exist)
    // 3. All inputs are successful
    // 4. All invocations are successful (regardless of origin - supports mixed evaluations)
    const canAnnotate =
        humanAnnotationKeys.length > 0 &&
        pendingHumanInvocationStepKey === undefined &&
        allInputsSuccessful &&
        allInvocationsSuccessful

    // Priority: Show Run button if there's a pending human invocation
    if (pendingHumanInvocationStepKey) {
        return (
            <div className="flex h-full items-center justify-center">
                <RunActionButton
                    onClick={() =>
                        handleRunClick(scenarioId, effectiveRunId, pendingHumanInvocationStepKey)
                    }
                />
            </div>
        )
    }

    // Show Annotate button if conditions are met
    if (canAnnotate) {
        return (
            <div className="flex h-full items-center justify-center">
                <AnnotateActionButton
                    onClick={() => handleAnnotateClick(scenarioId, effectiveRunId)}
                />
            </div>
        )
    }

    return <div className="flex h-full items-center justify-center text-xs text-neutral-400">—</div>
}

export default memo(PreviewActionCell)
