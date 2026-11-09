import type {ComponentProps} from "react"

import {SessionAgentIdentity} from "./SessionAgentIdentity"

/**
 * The config pane's own top: the agent it configures. The pane runs the full height, so the
 * session bar beside it holds only sessions, and the open tab always sits over the transcript.
 */
export const ConfigPaneHeader = (props: ComponentProps<typeof SessionAgentIdentity>) => (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-[var(--ag-surface-tab-bar)] px-3.5">
        <SessionAgentIdentity {...props} />
    </div>
)
