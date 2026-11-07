import {lazy, type ComponentType, type LazyExoticComponent} from "react"

import {loadWithText} from "@agenta/i18n"

/**
 * A click-opened panel: its code and its text load on first open. Returns a getter; after a
 * failed load the getter hands out a fresh lazy component, so the next render loads it again.
 */
export const lazyPanel = <P extends object>(load: () => Promise<ComponentType<P>>) => {
    const make = (): LazyExoticComponent<ComponentType<P>> =>
        lazy(() =>
            loadWithText(load).then(
                (component) => ({default: component}),
                (error: unknown) => {
                    current = make()
                    throw error
                },
            ),
        )
    let current = make()
    return () => current
}
