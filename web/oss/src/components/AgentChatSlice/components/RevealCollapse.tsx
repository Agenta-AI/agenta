import {type ReactNode} from "react"

import {HeightCollapse} from "@agenta/ui"

/**
 * Appear/disappear collapse for chat-composer chrome (connect-model banner, queued messages, HITL
 * dock). A thin wrapper over the shared {@link HeightCollapse} with `fade` + `inert`, so everything
 * that enters/leaves the composer region collapses the SAME CSS-native, reduced-motion-proof way as
 * the config accordion sections and the config-pane notices — one language, no `motion-safe` gate.
 * Callers that render nothing when "closed" should latch their last content so it persists through
 * the leave (see `ConnectModelBanner`).
 */
const RevealCollapse = ({
    open,
    className,
    children,
}: {
    open: boolean
    className?: string
    children: ReactNode
}) => (
    <HeightCollapse open={open} className={className} durationMs={240} fade inert>
        {children}
    </HeightCollapse>
)

export default RevealCollapse
