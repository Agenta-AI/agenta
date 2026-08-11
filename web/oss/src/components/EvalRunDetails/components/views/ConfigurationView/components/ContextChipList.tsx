import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {TestsetChipList, VariantReferenceChip} from "@/oss/components/References"

import {effectiveProjectIdAtom} from "../../../../atoms/run"
import {runInvocationRefsAtomFamily, runTestsetIdsAtomFamily} from "../../../../atoms/runDerived"
import {toIdString} from "../utils"

export interface ContextChipListProps {
    runId: string
}

const ContextChipList = ({runId}: ContextChipListProps) => {
    const projectId = useAtomValue(effectiveProjectIdAtom)
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
            {variantId ? (
                <VariantReferenceChip revisionId={variantId} projectId={projectId} />
            ) : null}
            <TestsetChipList ids={testsetIds} projectId={projectId} />
        </div>
    )
}

export default ContextChipList
