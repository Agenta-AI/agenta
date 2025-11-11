import {memo, useCallback} from "react"

import {Segmented} from "antd"
import {useSetAtom, useAtomValue} from "jotai"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    totalCountFamily,
    evalScenarioFilterAtom,
    pendingCountFamily,
    unannotatedCountFamily,
    failedCountFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

const EvalRunScenarioFilters = () => {
    const runId = useRunId()

    // Read from the same global store that writes are going to
    const setFilterAtom = useSetAtom(evalScenarioFilterAtom)
    const filter = useAtomValue(evalScenarioFilterAtom)
    const totalCount = useAtomValue(totalCountFamily(runId))
    const pendingCount = useAtomValue(pendingCountFamily(runId))
    const unannotatedCount = useAtomValue(unannotatedCountFamily(runId))
    const failedCount = useAtomValue(failedCountFamily(runId))

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
