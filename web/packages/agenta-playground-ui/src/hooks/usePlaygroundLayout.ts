import {useMemo} from "react"

import {playgroundController} from "@agenta/playground"
import {useAtomValue} from "jotai"

/**
 * Lightweight hook for layout components that only need display/selection state.
 * Uses resolved entities for render safety so URL-hydrated IDs do not render
 * before entity details are fetched.
 * Does NOT subscribe to individual entity changes or property mutations.
 */
export const usePlaygroundLayout = () => {
    const layoutState = useAtomValue(
        useMemo(() => playgroundController.selectors.playgroundLayout(), []),
    )
    return layoutState
}
