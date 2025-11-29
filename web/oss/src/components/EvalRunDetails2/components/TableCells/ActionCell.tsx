import {memo, useMemo, useCallback} from "react"

import {Spin} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

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

const PreviewActionCell = ({scenarioId, runId}: {scenarioId?: string; runId?: string}) => {
    const fallbackRunId = useAtomValue(activePreviewRunIdAtom)
    const effectiveRunId = runId ?? fallbackRunId ?? undefined
    const setAnnotateDrawer = useSetAtom(virtualScenarioTableAnnotateDrawerAtom)

    const runIndex = useAtomValue(evaluationRunIndexAtomFamily(effectiveRunId ?? null))
    const handleRunClick = useCallback((scenarioId: string, runId?: string, stepKey?: string) => {
        console.info("[EvalRunDetails2] Run scenario action triggered", {
            scenarioId,
            runId,
            stepKey,
        })
    }, [])

    const handleAnnotateClick = useCallback(
        (scenarioId: string, runId?: string) => {
            console.info("[EvalRunDetails2] Annotate action triggered", {scenarioId, runId})
            setAnnotateDrawer((prev) => ({
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
        },
        [setAnnotateDrawer],
    )

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

    if (humanInvocationKeys.length === 0 && humanAnnotationKeys.length === 0) {
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

    const pendingInvocationStepKey = humanInvocationKeys.find((key) => {
        const status = normalizeStatus(invocationMap.get(key))
        return status !== "success"
    })

    const allInputsSuccessful =
        inputSelection.steps.length > 0 &&
        inputSelection.steps.every((step) => normalizeStatus(step.status) === "success")

    const allInvocationsSuccessful =
        invocationSelection.steps.length > 0 &&
        invocationSelection.steps.every((step) => normalizeStatus(step.status) === "success")

    const showAnnotateButton =
        pendingInvocationStepKey === undefined &&
        humanAnnotationKeys.length > 0 &&
        allInputsSuccessful &&
        allInvocationsSuccessful

    if (pendingInvocationStepKey) {
        return (
            <div className="flex h-full items-center justify-center">
                <RunActionButton
                    onClick={() =>
                        handleRunClick(scenarioId, effectiveRunId, pendingInvocationStepKey)
                    }
                />
            </div>
        )
    }

    if (showAnnotateButton) {
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
