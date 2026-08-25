/**
 * Desktop shell around the shared `ConnectDock` — the persistent "the agent is waiting for you"
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
import {memo, useRef} from "react"

import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {ConnectDock} from "@agenta/chat/components"
import type {ConnectDockState} from "@agenta/chat/hooks"

interface InteractionDockProps {
    /** Parked connect interactions the run is blocked on (from `useConnectDock`). */
    connects: ConnectDockState
    /** Settle channel — the panel maps this onto `addToolOutput` (marks the resume as live). */
    onOutput: ClientToolOutputHandler
    /** False while an approval gate is pending — approvals own Cmd/Ctrl+Enter and Escape. */
    shortcutsEnabled?: boolean
    className?: string
}

/**
 * Always mounted; enter + leave animate via the grid-rows 0fr↔1fr height collapse (+ opacity), the
 * same idiom as ApprovalDock. `inert` while closed drops the (clipped, latched) card from tab order
 * + a11y so a keyboard user can't reach hidden buttons.
 */
const InteractionDock = ({
    connects,
    onOutput,
    shortcutsEnabled = true,
    className,
}: InteractionDockProps) => {
    const {open, stack, batch, position, total, bringForward} = connects
    // Latch the last non-empty stack (and its counter) so the card holds through the collapse.
    const shownRef = useRef({stack, batch, position, total})
    if (open) shownRef.current = {stack, batch, position, total}
    const shown = shownRef.current

    return (
        <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            } ${className ?? ""}`}
            inert={!open}
        >
            <div className="min-h-0 overflow-hidden">
                {shown.stack.length ? (
                    <ConnectDock
                        className="mb-2"
                        interactions={shown.stack}
                        batch={shown.batch}
                        position={shown.position}
                        total={shown.total}
                        onBringForward={bringForward}
                        onOutput={onOutput}
                        active={open}
                        shortcutsEnabled={shortcutsEnabled}
                    />
                ) : null}
            </div>
        </div>
    )
}

export default memo(InteractionDock)
