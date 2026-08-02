import {Hourglass} from "@phosphor-icons/react"

/** Compact three-dot pulse for the meta row under the last turn — the run-in-progress signal.
 * Deliberately NOT a Bubble: it shares one line with "Inspect turn" instead of adding a
 * bubble-sized row of its own. */
export const WorkingDots = () => (
    <span
        role="status"
        aria-label="Agent is working"
        className="flex items-center gap-1 px-1 py-0.5"
    >
        <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-colorTextTertiary [animation-duration:1.2s]" />
        <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-colorTextTertiary [animation-delay:0.2s] [animation-duration:1.2s]" />
        <span className="inline-block h-[5px] w-[5px] animate-pulse rounded-full bg-colorTextTertiary [animation-delay:0.4s] [animation-duration:1.2s]" />
    </span>
)

/** The WorkingDots slot while the run is PARKED on the user (approval / connect / elicitation).
 * The stream reads "ready" there, so without this the turn looks finished while the queue silently
 * holds new sends. Deliberately static: motion says "the agent is working" — here it's your move. */
export const WaitingForInput = () => (
    <span
        role="status"
        aria-label="Agent is waiting for your input"
        className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-colorTextTertiary"
    >
        <Hourglass size={12} />
        Waiting for your input
    </span>
)
