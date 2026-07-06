import {type ReactNode} from "react"

/**
 * Appear/disappear collapse for chat-composer chrome (connect-model banner, queued messages, HITL dock).
 * Animates height 0↔auto via the grid `0fr`↔`1fr` trick plus opacity — the same idiom the ApprovalDock
 * and the config sections use, so everything that enters/leaves the composer region does so consistently.
 * Content is clipped by `overflow-hidden` while collapsing; `inert` drops the hidden subtree from tab
 * order + a11y. Callers that render nothing when "closed" should latch their last content so it persists
 * through the leave (see `ConnectModelBanner`).
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
    <div
        className={`grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-out ${
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        } ${className ?? ""}`}
        inert={!open}
    >
        <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
)

export default RevealCollapse
