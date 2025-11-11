import {memo, useCallback} from "react"

import {Segmented} from "antd"
import {useSetAtom, useAtomValue} from "jotai"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    evalAtomStore,
    totalCountFamily,
    evalScenarioFilterAtom,
    pendingCountFamily,
    unannotatedCountFamily,
    failedCountFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

const EvalRunScenarioFilters = () => {
    const runId = useRunId()
    const store = evalAtomStore()

    // Read from the same global store that writes are going to
    const setFilterAtom = useSetAtom(evalScenarioFilterAtom, {store})
    const filter = useAtomValue(evalScenarioFilterAtom, {store})
    const totalCount = useAtomValue(totalCountFamily(runId), {store})
    const pendingCount = useAtomValue(pendingCountFamily(runId), {store})
    const unannotatedCount = useAtomValue(unannotatedCountFamily(runId), {store})
    const failedCount = useAtomValue(failedCountFamily(runId), {store})

    const handleChange = useCallback((val: string) => {
        setFilterAtom(val as any)
    }, [])

    return (
        <Segmented
            size="small"
            rootClassName="evaluation-filters !my-0"
            options={[
                {label: `All (${totalCount})`, value: "all"},
                {label: `Pending (${pendingCount})`, value: "pending"},
                {label: `Unannotated (${unannotatedCount})`, value: "unannotated"},
                {label: `Failed (${failedCount})`, value: "failed"},
            ]}
            value={filter}
            onChange={handleChange}
        />
    )
}

export default memo(EvalRunScenarioFilters)
