import {useMemo} from "react"

export interface UseRowIdForVariantParams {
    sessionTurnId?: string | null
    logicalMap?: Record<string, string> | null
    variantId?: string | null
    turnId: string
}

const useRowIdForVariant = ({
    sessionTurnId,
    logicalMap,
    variantId,
    turnId,
}: UseRowIdForVariantParams) => {
    return useMemo(() => {
        return sessionTurnId || (logicalMap as any)?.[variantId as string] || turnId
    }, [sessionTurnId, logicalMap, variantId, turnId])
}

export default useRowIdForVariant
