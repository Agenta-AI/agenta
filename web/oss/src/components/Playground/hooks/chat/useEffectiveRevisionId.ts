import {useMemo} from "react"

export const useEffectiveRevisionId = (
    variantId: string | undefined,
    displayedVariantIds: string[] | undefined,
) =>
    useMemo(() => {
        if (variantId && typeof variantId === "string") return variantId
        const ids = Array.isArray(displayedVariantIds) ? displayedVariantIds : []
        return ids[0] || ""
    }, [variantId, displayedVariantIds])

export default useEffectiveRevisionId
