import {useAtomValue} from "jotai"

import {playgroundLayoutAtom} from "../../state/atoms"

/**
 * Lightweight hook for layout components that only need display/selection state.
 * OPTIMIZED: Uses early displayed variants for faster loading - gets revision IDs
 * as soon as raw variant data is available, before enhanced transformations.
 * Does NOT subscribe to individual variant changes or property mutations.
 */
export const usePlaygroundLayout = () => {
    // PERFORMANCE OPTIMIZATION: Single atom subscription instead of multiple
    // All layout logic is computed in the atom with proper memoization
    const layoutState = useAtomValue(playgroundLayoutAtom)

    return layoutState
}
