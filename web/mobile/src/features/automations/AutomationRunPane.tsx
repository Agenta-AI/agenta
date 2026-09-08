import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {ArrowLeft} from "@phosphor-icons/react"

import {ICON_LINK} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {AutomationRunConversation} from "./AutomationRunConversation"
import {
    runDotClass,
    runDuration,
    runError,
    runLabel,
    runOutcomeLabel,
    runSessionId,
    runWhenLabel,
} from "./runModel"
import {AutomationRunNoConversation} from "./states/AutomationRunStates"

/**
 * One run, opened: what it was and when, over the conversation it produced.
 *
 * The header states the run so the pane is readable on its own — on a narrow frame it replaces
 * the list entirely, and a transcript with no heading gives no way back and no way to tell which
 * run is on screen. `onBack` is supplied only in that narrow case; from the split layout the
 * list is still visible and an extra back arrow would point at nothing.
 */
export const AutomationRunPane = ({
    delivery,
    projectId,
    workspaceId,
    agentId,
    onBack,
}: {
    delivery: TriggerDelivery
    projectId: string
    workspaceId: string
    /** The automation's bound agent, for a run whose session has no turns to name one. */
    agentId: string | null
    /** Narrow layout only — the list is off screen, so the pane owns the way back to it. */
    onBack?: () => void
}) => {
    const sessionId = runSessionId(delivery)
    const label = runLabel(delivery)
    // The same day-and-time vocabulary the rows speak, so the header names the row you picked.
    const when = runWhenLabel(delivery)
    // No duration field on a delivery — see `runDuration`. When it cannot be derived the clause
    // is dropped rather than printed as zero.
    const took = runDuration(delivery)
    const meta = [when, took ? `took ${took}` : ""].filter(Boolean).join(" · ")

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2.5 px-3.5 py-3">
                {onBack ? (
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label="Back to the run list"
                        className={cn(
                            "-ml-1 flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-1 text-muted-foreground",
                            ICON_LINK,
                        )}
                    >
                        <ArrowLeft aria-hidden size={15} />
                    </button>
                ) : null}
                <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", runDotClass(delivery))}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-medium text-foreground">
                        {label}
                        <span className="sr-only"> — {runOutcomeLabel(delivery)}</span>
                    </span>
                    {meta ? (
                        <span className="truncate text-xs text-muted-foreground">{meta}</span>
                    ) : null}
                </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
                {sessionId ? (
                    <AutomationRunConversation
                        sessionId={sessionId}
                        projectId={projectId}
                        workspaceId={workspaceId}
                        agentId={agentId}
                    />
                ) : (
                    <AutomationRunNoConversation reason={runError(delivery)} />
                )}
            </div>
        </div>
    )
}
