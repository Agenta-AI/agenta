import {lazy, Suspense, type ComponentType, type ReactNode} from "react"

import type {ViewProps} from "@agenta/ui/view-stack"

/** A view body that loads on first open, with a fallback in its own place while it loads. */
export const lazyView = <P,>(
    load: () => Promise<{default: ComponentType<ViewProps<P>>}>,
    fallback: ReactNode = null,
): ComponentType<ViewProps<P>> => {
    const Body = lazy(load)
    const LazyView = (props: ViewProps<P>) => (
        <Suspense fallback={fallback}>
            <Body {...props} />
        </Suspense>
    )
    return LazyView
}
