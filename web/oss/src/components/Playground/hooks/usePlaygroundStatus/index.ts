import {useAtomValue} from "jotai"

import {playgroundLoadingAtom} from "@/oss/state/loadingSelectors"

import {
    selectedVariantsAtom,
    variantsIsLoadingAtom,
    variantsHasDataAtom,
    variantsErrorAtom,
} from "../../state/atoms"

/**
 * Lightweight hook for status/loading components that only need loading and error state.
 * Does NOT subscribe to individual variant changes or property mutations.
 */
export const usePlaygroundStatus = () => {
    const isLoading = useAtomValue(playgroundLoadingAtom)
    const variantsLoading = useAtomValue(variantsIsLoadingAtom)
    const variantsHasData = useAtomValue(variantsHasDataAtom)
    const variantsError = useAtomValue(variantsErrorAtom)
    const selectedVariants = useAtomValue(selectedVariantsAtom)

    return {
        isLoading,
        error: variantsError,
        selectedVariants,
        hasData: variantsHasData,
        isVariantsLoading: variantsLoading,
    }
}
