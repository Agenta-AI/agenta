import {useCallback} from "react"

import {useSetAtom} from "jotai"

import {cancelTestsMutationAtom} from "../../state/atoms"
import type {UsePlaygroundAtomsReturn} from "../../state/types"

export function usePlaygroundAtoms(): UsePlaygroundAtomsReturn {
    // Test execution with web worker integration
    const cancelTestsOriginal = useSetAtom(cancelTestsMutationAtom)

    // Enhanced cancelTests wrapper
    const cancelRunTests = useCallback(
        (rowId?: string, variantId?: string) => {
            if (rowId) {
                cancelTestsOriginal({rowId, variantId})
            } else {
                // Cancel all tests
                cancelTestsOriginal({})
            }
        },
        [cancelTestsOriginal],
    )

    return {
        cancelRunTests,
    }
}
