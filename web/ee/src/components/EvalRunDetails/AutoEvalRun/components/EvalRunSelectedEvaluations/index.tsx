import {memo, useMemo} from "react"

import deepEqual from "fast-deep-equal"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    evalAtomStore,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import EvalNameTag from "../../assets/EvalNameTag"
import {EVAL_TAG_COLOR} from "../../assets/utils"

const comparisonRunsAtom = atomFamily(
    (runIds: string[]) =>
        atom((get) => {
            return runIds.map((runId) => {
                const state = get(evaluationRunStateFamily(runId))
                return {
                    runId,
                    run: state?.enrichedRun,
                    compareIndex: state?.compareIndex,
                    isBase: state?.isBase,
                    isComparison: state?.isComparison,
                }
            })
        }),
    deepEqual,
)
const EvalRunSelectedEvaluations = ({runIds, baseRunId}: {runIds: string[]; baseRunId: string}) => {
    // Build a stable, de-duplicated list so transient states (during swaps) don't render duplicates
    const uniqueIds = useMemo(() => {
        const list = [baseRunId, ...runIds]
        const seen = new Set<string>()
        return list.filter((id) => {
            if (!id || seen.has(id)) return false
            seen.add(id)
            return true
        })
    }, [baseRunId, runIds.join(",")])

    const runs = useAtomValue(comparisonRunsAtom(uniqueIds), {store: evalAtomStore()})

    return (
        <section className="flex items-center gap-2 min-w-0">
            <span className="shrink-0">Evaluations:</span>
            <div className="relative min-w-0 flex-1">
                <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pr-1 [&::-webkit-scrollbar]:!w-0 [&::-webkit-scrollbar]:!h-0">
                    {runs
                        ?.filter((r) => Boolean(r?.run))
                        .map((r) => {
                            const idx = r?.compareIndex ?? (r?.isBase ? 1 : undefined)
                            const color = idx ? (EVAL_TAG_COLOR as any)[idx] : undefined
                            return (
                                <EvalNameTag
                                    key={r?.run?.id || r?.runId}
                                    run={r!.run!}
                                    showClose
                                    showPin
                                    isBaseEval={r?.isBase}
                                    color={color}
                                />
                            )
                        })}
                </div>
                {/* <div className="pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l from-white to-transparent" /> */}
            </div>
        </section>
    )
}

export default memo(EvalRunSelectedEvaluations)
