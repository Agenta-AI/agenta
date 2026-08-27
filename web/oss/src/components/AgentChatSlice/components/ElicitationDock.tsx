/**
 * Desktop shell around the shared `ElicitationDock` — the docked question card, sibling of
 * ApprovalDock and ConnectionDock with the same placement contract: it lives in the composer region
 * (between the transcript and the input) so a paused run can't scroll out of reach, and it OWNS the
 * actions while the inline transcript row is a passive marker.
 *
 * It replaces the inline card that used to hold every field of a `request_input` at once. That card
 * grew and shrank inside the transcript as the user typed, and each height change drove the
 * transcript's ResizeObserver into a scroll write — the composer moved under the cursor. Docked, the
 * card has one fixed box and the transcript never reflows.
 *
 * Slot order in `AgentComposerDock` is approval → elicitation → connect, matching the keyboard
 * precedence, so visual and shortcut order never disagree.
 */
import {memo} from "react"

import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {ElicitationDock} from "@agenta/chat/components"
import type {ElicitationDockState} from "@agenta/chat/hooks"

interface AgentElicitationDockProps {
    /** Parked question forms the run is blocked on (from `useElicitationDock`). */
    elicits: ElicitationDockState
    /** Settle channel — the card maps this onto `addToolOutput` (marks the resume as live). */
    onOutput: ClientToolOutputHandler
    className?: string
}

/**
 * Always mounted; enter + leave animate via the grid-rows 0fr↔1fr height collapse (+ opacity), the
 * same idiom as ConnectionDock. `inert` while closed drops the (clipped, latched) card from tab
 * order + a11y so a keyboard user can't reach hidden controls.
 */
const AgentElicitationDock = ({elicits, onOutput, className}: AgentElicitationDockProps) => {
    // `useElicitationDock` latches its own view, so the card survives the collapse without a ref.
    const {open, front} = elicits

    return (
        <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            } ${className ?? ""}`}
            inert={!open}
        >
            <div className="min-h-0 overflow-hidden">
                {front ? (
                    <ElicitationDock
                        className="mb-2"
                        elicits={elicits}
                        onOutput={onOutput}
                        active={open}
                    />
                ) : null}
            </div>
        </div>
    )
}

export default memo(AgentElicitationDock)
