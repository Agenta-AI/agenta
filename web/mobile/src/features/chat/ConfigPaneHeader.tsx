import type {ComponentProps, ReactNode} from "react"

import {ConfigPaneToggle} from "./ConfigPaneToggle"
import {SessionAgentIdentity} from "./SessionAgentIdentity"

/**
 * The config pane's own top: the agent it configures, and the button that hides the pane. The
 * pane runs the full height, so the session bar beside it holds only sessions.
 */
export const ConfigPaneHeader = ({
    leading,
    onHide,
    ...props
}: ComponentProps<typeof SessionAgentIdentity> & {
    /** The nav menu below `lg`, at the window's left edge. */
    leading?: ReactNode
    onHide: () => void
}) => (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-[var(--ag-surface-tab-bar)] pl-3.5 pr-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
            {leading ? <span className="-ml-1 flex lg:hidden">{leading}</span> : null}
            <SessionAgentIdentity {...props} />
        </div>
        <ConfigPaneToggle open onToggle={onHide} />
    </div>
)
