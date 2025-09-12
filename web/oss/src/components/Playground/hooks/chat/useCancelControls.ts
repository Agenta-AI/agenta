import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {
    cancelTestsMutationAtom,
    displayedVariantsAtom,
} from "@/oss/components/Playground/state/atoms"

export const useCancelControls = () => {
    const cancelTests = useSetAtom(cancelTestsMutationAtom)
    const displayedVariantIds = useAtomValue(displayedVariantsAtom)

    const onCancelAll = useCallback(() => {
        const vids = displayedVariantIds || []
        cancelTests({variantIds: vids, reason: "user_cancelled"} as any)
    }, [cancelTests, displayedVariantIds])

    return {onCancelAll}
}

export default useCancelControls
