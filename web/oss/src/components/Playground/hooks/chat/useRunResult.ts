import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"

interface Params {
    rowId?: string
    variantId?: string
}

export const useRunResult = ({rowId, variantId}: Params) => {
    const runKey = useMemo(() => {
        if (!rowId || !variantId) return ""
        return `${rowId}:${variantId}`
    }, [rowId, variantId])

    const statusAtom = useMemo(
        () => (runKey ? atom((get) => get(runStatusByRowRevisionAtom)[runKey] || {}) : atom({})),
        [runKey],
    )

    const {isRunning, resultHash} = useAtomValue(statusAtom) as {
        isRunning?: string | boolean
        resultHash?: string | null
    }

    const result = useMemo(() => (resultHash ? getResponseLazy(resultHash) : null), [resultHash])

    return {isRunning: Boolean(isRunning), resultHash: (resultHash as string) || null, result}
}

export default useRunResult
