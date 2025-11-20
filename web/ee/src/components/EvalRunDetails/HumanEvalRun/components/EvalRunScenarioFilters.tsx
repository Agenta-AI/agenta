import {memo, useCallback} from "react"

import {Segmented} from "antd"
import {useSetAtom, useAtomValue} from "jotai"

import {
    evalScenarioFilterAtom,
    pendingCountAtom,
    unannotatedCountAtom,
    failedCountAtom,
    totalCountAtom,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

const EvalRunScenarioFilters = () => {
    const setFilterAtom = useSetAtom(evalScenarioFilterAtom)
    const filter = useAtomValue(evalScenarioFilterAtom)
    const totalCount = useAtomValue(totalCountAtom)
    const pendingCount = useAtomValue(pendingCountAtom)
    const unannotatedCount = useAtomValue(unannotatedCountAtom)
    const failedCount = useAtomValue(failedCountAtom)

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
