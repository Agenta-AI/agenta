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

/**
 * The empty-turn slot during a COLD start (#6047): what the agent is doing, in words, instead of
 * the wordless three dots that made a 15s sandbox boot read as a stalled session.
 *
 * Presentational only — `label` is chosen by `useStartupPhase` on a timer. The dots match
 * `WorkingDots` so the two indicators read as one family, just smaller beside text, and sit at the
 * END of the line so they trail the words like an ellipsis rather than floating mid-height.
 * `aria-live` announces each phase change; the shimmer is `motion-safe` and degrades to plain text.
 */
export const StartupActivity = ({label}: {label: string}) => (
    <span role="status" aria-live="polite" className="flex items-end gap-2 py-0.5">
        <span className="bg-[linear-gradient(90deg,var(--ag-colorTextQuaternary)_0%,var(--ag-colorText)_45%,var(--ag-colorTextQuaternary)_90%)] bg-clip-text text-sm text-colorTextSecondary motion-safe:animate-text-shimmer motion-safe:bg-[length:240%_100%] motion-safe:text-transparent">
            {label}
        </span>
        <span aria-hidden className="flex items-end gap-1 pb-1">
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-colorTextTertiary [animation-duration:1.2s]" />
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-colorTextTertiary [animation-delay:0.2s] [animation-duration:1.2s]" />
            <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-colorTextTertiary [animation-delay:0.4s] [animation-duration:1.2s]" />
        </span>
    </span>
)
