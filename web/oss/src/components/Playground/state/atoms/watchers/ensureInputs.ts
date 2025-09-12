import {getDefaultStore} from "jotai"

import {inputRowIdsAtom as normInputRowIdsAtom} from "@/oss/state/generation/entities"

import {addGenerationInputRowMutationAtom as addVariablesInputRowMutationAtom} from "../mutations/input/addInputRow"
import {ensureInitialInputRowAtom} from "../mutations/input/ensureInitialRow"
import {displayedVariantsAtom, displayedVariantsVariablesAtom} from "../variants"

// Attach onMount to ensure we always have at least one inputs row when variables exist
ensureInitialInputRowAtom.onMount = (setSelf: any) => {
    const store = getDefaultStore()
    const checkAndInit = () => {
        try {
            const currentIds = store.get(normInputRowIdsAtom) as string[]
            if (currentIds.length > 0) return
            const displayed = store.get(displayedVariantsAtom) as string[]

            if (!Array.isArray(displayed) || displayed.length === 0) return
            store.set(addVariablesInputRowMutationAtom)
            setSelf(1 as unknown as never)
        } catch {
            // no-op
        }
    }

    checkAndInit()

    const unsubs: (() => void)[] = []
    unsubs.push(store.sub(normInputRowIdsAtom, checkAndInit))
    unsubs.push(store.sub(displayedVariantsAtom, checkAndInit))
    unsubs.push(store.sub(displayedVariantsVariablesAtom, checkAndInit))

    return () => {
        unsubs.forEach((unsub) => {
            unsub()
        })
    }
}
