import {useMemo} from "react"

import {runInvocationRefsAtomFamily} from "@agenta/evaluations/state/evalRun"
import {useAtomValue} from "jotai"

export interface RunIdentifierSnapshot {
    applicationId: string | null
    applicationVariantId: string | null
    variantId: string | null
    rawRefs?: Record<string, any>
}

const useRunIdentifiers = (runId?: string | null): RunIdentifierSnapshot => {
    const refsAtom = useMemo(() => runInvocationRefsAtomFamily(runId ?? null), [runId])
    const refs = useAtomValue(refsAtom)

    return useMemo(
        () => ({
            applicationId: refs.applicationId ?? null,
            applicationVariantId: refs.applicationVariantId ?? null,
            variantId: refs.variantId ?? null,
            rawRefs: refs.rawRefs,
        }),
        [refs.applicationId, refs.applicationVariantId, refs.rawRefs, refs.variantId],
    )
}

export default useRunIdentifiers
