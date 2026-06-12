import {useMemo} from "react"

import {
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
} from "@agenta/evaluations/state/evalRun"
import {useAtomValue} from "jotai"

import {useHostComponent} from "../../../../../../host/hostRegistry"
import {toIdString} from "../utils"

export interface ContextChipListProps {
    runId: string
}

const ContextChipList = ({runId}: ContextChipListProps) => {
    const TestsetChipList = useHostComponent("TestsetChipList")
    const VariantReferenceChip = useHostComponent("VariantReferenceChip")
    const variantRefs = useAtomValue(useMemo(() => runInvocationRefsAtomFamily(runId), [runId]))
    const variantId = useMemo(
        () => toIdString(variantRefs.variantId ?? variantRefs.applicationVariantId ?? null),
        [variantRefs],
    )
    const testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId), [runId]))

    if (!variantId && testsetIds.length === 0) {
        return null
    }

    return (
        <div className="mb-4 flex flex-wrap items-center gap-2">
            {variantId ? <VariantReferenceChip variantId={variantId} /> : null}
            <TestsetChipList ids={testsetIds} />
        </div>
    )
}

export default ContextChipList
