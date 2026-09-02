import {ChatTypingDots} from "@agenta/ui/components/presentational"
import {Hourglass} from "lucide-react"

/**
 * The meta line under the last turn — desktop's WorkingDots/WaitingForInput pair. While the
 * run works, the pulse says so; while it is PARKED on the user (a pending approval), the
 * stream reads "ready", so without the hourglass the turn looks finished even though the
 * queue silently holds new sends. Deliberately static in that state: motion means "the agent
 * is working" — here it's your move.
 */
export const TurnStatusLine = ({
    working,
    waitingForInput,
}: {
    working: boolean
    waitingForInput: boolean
}) => {
    if (waitingForInput) {
        return (
            <span
                role="status"
                aria-label="Agent is waiting for your input"
                className="text-colorTextTertiary flex items-center gap-1.5 px-1 py-0.5 text-xs"
            >
                <Hourglass className="size-3" />
                Waiting for your input
            </span>
        )
    }
    if (working) {
        return (
            <span role="status" aria-label="Agent is working" className="px-1 py-0.5">
                <ChatTypingDots />
            </span>
        )
    }
    return null
}
