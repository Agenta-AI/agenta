import {memo, useCallback} from "react"

import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {WaitingForInput, WorkingDots} from "@agenta/chat/components"
import {Tag} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {TreeStructure} from "@phosphor-icons/react"
import {type UIMessage} from "ai"

import AgentMessage from "./AgentMessage"
import MessageRow from "./MessageRow"

interface AgentTurnProps {
    message: UIMessage
    sessionId: string
    /** Fade in once — this turn arrived after mount. */
    enter: boolean
    isLast: boolean
    isStreaming: boolean
    /** The previous turn is a settled assistant turn with no content at all. */
    precededByEmptyAssistant: boolean
    /** A user turn borrows the paired assistant turn's trace so its timestamp dates from the run. */
    turnTraceId?: string
    /** This turn is the inspector's current target — tint it. */
    inspected: boolean
    /** Inspector panel open + assistant turn → clicking the row re-points the inspector here. */
    rowInspectable: boolean
    /** Show the "Inspect turn" affordance in the meta row. */
    showInspect: boolean
    /** 1-based turn number, or undefined for a user turn. */
    turn?: number
    onInspectTurn: (turn: number) => void
    showWorking: boolean
    showWaiting: boolean
    showStopped: boolean
    resendDisabled: boolean
    onResend: (messageId: string) => void
    onRewind: (message: UIMessage) => void
    onClientToolOutput: ClientToolOutputHandler
    /** Settled row → `content-visibility:auto` while off-screen. */
    offscreenSkip: boolean
    liveRunError?: {message: string; code?: number}
}

/**
 * One turn in the transcript: the message itself plus its trailing affordances (the Stopped/Resend
 * pair and the meta row). Memoized — the transcript re-renders on every streamed token, and without
 * this every settled turn above the active one re-rendered with it. Every prop is a primitive or a
 * stable callback so the memo actually holds.
 */
const AgentTurn = ({
    message,
    sessionId,
    enter,
    isLast,
    isStreaming,
    precededByEmptyAssistant,
    turnTraceId,
    inspected,
    rowInspectable,
    showInspect,
    turn,
    onInspectTurn,
    showWorking,
    showWaiting,
    showStopped,
    resendDisabled,
    onResend,
    onRewind,
    onClientToolOutput,
    offscreenSkip,
    liveRunError,
}: AgentTurnProps) => {
    const inspect = useCallback(() => onInspectTurn(turn ?? 1), [onInspectTurn, turn])
    return (
        <MessageRow
            mid={message.id}
            enter={enter}
            inspected={inspected}
            onInspect={rowInspectable ? inspect : undefined}
            offscreenSkip={offscreenSkip}
        >
            <AgentMessage
                message={message}
                sessionId={sessionId}
                isStreaming={isStreaming}
                isLastMessage={isLast}
                onRewind={onRewind}
                onClientToolOutput={onClientToolOutput}
                precededByEmptyAssistant={precededByEmptyAssistant}
                turnTraceId={turnTraceId}
                // A transient run failure offers "Try again" — the same regenerate wiring as the
                // Stopped → Resend pair, and gated the same way: last turn only, never while busy.
                onRetry={isLast && !resendDisabled ? onResend : undefined}
                liveRunError={isLast ? liveRunError : undefined}
            />
            {/* Stopped tag + Resend belong only to the LAST assistant turn (the one you cancelled),
                gated on position so it can never smear onto past turns. Cleared on resend / ask. */}
            {showStopped && (
                <div className="flex items-center gap-2 self-start pl-1">
                    <Tag label="Stopped" className="m-0 text-xs" />
                    <Button
                        variant="link"
                        size="sm"
                        className="px-0 text-xs"
                        disabled={resendDisabled}
                        onClick={() => onResend(message.id)}
                    >
                        Resend
                    </Button>
                </div>
            )}
            {/* Meta row: "Inspect turn" + the working dots share ONE compact line under the
                turn. The dots run for the WHOLE busy run — so gaps with no streaming output
                (approval-resume cold-replay, between steps, server tool waits) never read as
                frozen — and drop the moment the run settles. The affordance renders FIRST so
                its left edge stays put (and aligned with older turns') when the trailing dots
                unmount — no settle-time layout shift. An EMPTY streaming assistant turn
                already renders its own loading bubble (AgentMessage), so the dots skip it —
                exactly one indicator while busy. */}
            {(showWorking || showInspect || showWaiting) && (
                <div className="flex items-center gap-2 self-start">
                    {showInspect && (
                        <button
                            type="button"
                            onClick={inspect}
                            className="flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs text-colorTextSecondary transition-colors hover:text-colorPrimary"
                        >
                            <TreeStructure size={12} />
                            {inspected ? "Inspecting turn" : "Inspect turn"}
                        </button>
                    )}
                    {showWorking && <WorkingDots />}
                    {showWaiting && <WaitingForInput />}
                </div>
            )}
        </MessageRow>
    )
}

export default memo(AgentTurn)
