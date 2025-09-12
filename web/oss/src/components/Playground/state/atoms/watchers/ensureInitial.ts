import {getDefaultStore} from "jotai"

import {chatTurnsByIdAtom as normChatTurnsByIdAtom} from "@/oss/state/generation/entities"

// Attach onMount to ensure we always have a first chat row in chat mode
import {appChatModeAtom} from "../app"
import {ensureInitialChatRowAtom} from "../mutations/chat/ensureInitialRow"
import {addGenerationInputRowMutationAtom} from "../mutations/input/addInputRow"
import {displayedVariantsAtom} from "../variants"
;(ensureInitialChatRowAtom as any).onMount = (setSelf: any) => {
    const store = getDefaultStore()
    const checkAndInit = () => {
        try {
            const _isChat = store.get(appChatModeAtom)
            if (!_isChat) return
            const displayed = store.get(displayedVariantsAtom) as string[]
            const turnsCount = Object.keys(store.get(normChatTurnsByIdAtom) || {}).length

            if (turnsCount === 0 && Array.isArray(displayed) && displayed.length > 0) {
                store.set(addGenerationInputRowMutationAtom)
                setSelf(1 as unknown as never)
            }
        } catch {
            // no-op
        }
    }

    checkAndInit()

    const unsubs: (() => void)[] = []
    unsubs.push(store.sub(normChatTurnsByIdAtom, checkAndInit))
    unsubs.push(store.sub(displayedVariantsAtom, checkAndInit))
    unsubs.push(store.sub(appChatModeAtom, checkAndInit))

    return () => {
        unsubs.forEach((unsub) => {
            unsub()
        })
    }
}
