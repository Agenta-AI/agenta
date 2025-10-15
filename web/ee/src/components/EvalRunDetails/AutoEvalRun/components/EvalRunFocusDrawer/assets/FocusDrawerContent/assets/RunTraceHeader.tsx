import {memo} from "react"

import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import EvalNameTag from "@/oss/components/EvalRunDetails/AutoEvalRun/assets/EvalNameTag"
import {EVAL_TAG_COLOR} from "@/oss/components/EvalRunDetails/AutoEvalRun/assets/utils"
import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    evalAtomStore,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"

const GenerationResultUtils = dynamic(
    () =>
        import(
            "@/oss/components/Playground/Components/PlaygroundGenerations/assets/GenerationResultUtils"
        ),
    {ssr: false},
)

const RunTraceHeader = ({
    runId: rId,
    scenarioId: scId,
    stepKey,
    anchorId,
    showComparisons,
}: {
    runId: string
    scenarioId?: string
    stepKey?: string
    anchorId?: string
    showComparisons?: boolean
}) => {
    const baseRunId = useRunId()
    const store = evalAtomStore()
    const state = useAtomValue(evaluationRunStateFamily(rId), {store})
    const enriched = state?.enrichedRun
    const {trace: runTrace} = useInvocationResult({
        scenarioId: scId,
        stepKey: stepKey,
        editorType: "simple",
        viewType: "single",
        runId: rId,
    })

    return (
        <div
            className={clsx(
                showComparisons ? "w-[480px] shrink-0" : "w-full",
                "h-[40px] flex items-center justify-between px-3 border-0 border-r border-solid border-gray-200",
            )}
            id={anchorId}
        >
            {enriched ? (
                <EvalNameTag
                    run={enriched}
                    color={EVAL_TAG_COLOR?.[state?.compareIndex] || 1}
                    onlyShowBasePin
                    isBaseEval={enriched?.id === baseRunId}
                    className={showComparisons ? "max-w-[220px]" : ""}
                />
            ) : (
                <div className="h-[24.4px] w-[100px]" />
            )}
            {runTrace ? (
                <GenerationResultUtils
                    className="flex-row-reverse shrink-0"
                    result={{response: {tree: {nodes: [runTrace]}}}}
                    showStatus={false}
                />
            ) : (
                <div className="h-[24.4px] w-full" />
            )}
        </div>
    )
}

export default memo(RunTraceHeader)
