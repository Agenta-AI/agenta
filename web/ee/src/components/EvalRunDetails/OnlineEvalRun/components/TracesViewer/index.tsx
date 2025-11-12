import {memo} from "react"

import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

const TracesViewer = () => {
    const runId = useRunId()
    // const runState = useAtomValue(
    //     selectAtom(evaluationRunStateFamily(runId!), (v) => ({
    //         enrichedRun: v.enrichedRun,
    //         runIndex: v.runIndex,
    //     })),
    // ) as any

    // const steps = (runState?.runIndex?.steps && Object.values(runState.runIndex.steps)) || []

    // if (!steps.length) {
    //     return (
    //         <div className="w-full h-full flex items-center justify-center text-[#475467] text-sm">
    //             No traces available yet.
    //         </div>
    //     )
    // }

    return (
        <div className="w-full h-full overflow-auto px-6">
            {/* <div className="flex flex-col gap-2">
                {steps.map((s: any, idx: number) => (
                    <div key={idx} className="border rounded-md p-3">
                        <div className="text-xs text-[#667085]">{s?.type || "step"}</div>
                        <div className="text-sm break-words whitespace-pre-wrap">
                            {JSON.stringify(s, null, 2)}
                        </div>
                    </div>
                ))}
            </div> */}
        </div>
    )
}

export default memo(TracesViewer)
