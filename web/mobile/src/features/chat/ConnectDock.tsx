import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {ConnectDock as SharedConnectDock} from "@agenta/chat/components"
import type {ConnectDockState} from "@agenta/chat/hooks"

import {ContentRail} from "@/components/ContentRail"

/**
 * Bottom-anchored dock for parked `request_connection` calls — the SAME shared card (and stack,
 * when a turn asks for several connections) the desktop dock renders, in touch sizing. This
 * wrapper is only the mobile adapter: the rail and the padding.
 *
 * It sits outside the transcript scroller, above the composer, so a paused run can never scroll
 * out of reach — the same contract as `ApprovalDock`. Mobile had no such dock at all, so a parked
 * connection showed an inline "waiting for your response below" row with nothing below it.
 */
export const ConnectDock = ({
    connects,
    onOutput,
    shortcutsEnabled = true,
}: {
    connects: ConnectDockState
    onOutput: ClientToolOutputHandler
    /** False while an approval gate is pending — approvals own Cmd/Ctrl+Enter and Escape. */
    shortcutsEnabled?: boolean
}) => {
    if (!connects.open) return null
    return (
        <div className="bg-background shrink-0 px-3 pt-3 pb-0">
            <ContentRail>
                <SharedConnectDock
                    interactions={connects.stack}
                    batch={connects.batch}
                    position={connects.position}
                    total={connects.total}
                    onBringForward={connects.bringForward}
                    onOutput={onOutput}
                    shortcutsEnabled={shortcutsEnabled}
                    touch
                />
            </ContentRail>
        </div>
    )
}
