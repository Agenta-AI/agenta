/**
 * Desktop shell around the shared `ConnectionDock` — the persistent "the agent is waiting for you"
 * band for parked CLIENT-TOOL interactions, sibling of ApprovalDock with the same placement
 * contract: it lives in the composer region (between the transcript and the input) so a paused run
 * can't scroll out of reach, and it OWNS the actions while the inline transcript row is a marker.
 *
 * Why it exists (UX): when the runner parks a `request_connection`, the stream genuinely ends —
 * `useChat` reads "ready", so nothing busy-derived (working dots, stop button) signals the pause,
 * while the message queue silently holds every send (`isHitlPending`). This dock makes the paused
 * state visible where the user is typing AND provides the escape hatch a parked connection
 * previously lacked: "Not now" settles the call as a structured decline, so the run resumes and
 * the conversation unfreezes.
 *
 * The card itself (and the stack, when a turn parks several connections) is shared with /m; this
 * file keeps only the desktop chrome: the open/close height collapse and the column width.
 *
 * v1 covers the connect interaction (`request_connection` / render.kind "connect"). Elicitation
 * stays inline — it's a form the user fills in the transcript, and it carries its own
 * Decline/Dismiss actions; the composer's waiting state covers its visibility.
 */
import {memo} from "react"

import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {ConnectionDock} from "@agenta/chat/components"
import type {ConnectionDockState} from "@agenta/chat/hooks"

interface AgentConnectionDockProps {
    /** Parked connect interactions the run is blocked on (from `useConnectionDock`). */
    connects: ConnectionDockState
    /** Settle channel — the panel maps this onto `addToolOutput` (marks the resume as live). */
    onOutput: ClientToolOutputHandler
    className?: string
}

/**
 * Always mounted; enter + leave animate via the grid-rows 0fr↔1fr height collapse (+ opacity), the
 * same idiom as ApprovalDock. `inert` while closed drops the (clipped, latched) card from tab order
 * + a11y so a keyboard user can't reach hidden buttons.
 */
const AgentConnectionDock = ({connects, onOutput, className}: AgentConnectionDockProps) => {
    // `useConnectionDock` latches its own view, so the card survives the collapse without a ref here.
    const {open, stack} = connects

    return (
        <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            } ${className ?? ""}`}
            inert={!open}
        >
            <div className="min-h-0 overflow-hidden">
                {stack.length ? (
                    <ConnectionDock
                        className="mb-2"
                        connects={connects}
                        onOutput={onOutput}
                        active={open}
                    />
                ) : null}
            </div>
        </div>
    )
}

export default memo(AgentConnectionDock)
