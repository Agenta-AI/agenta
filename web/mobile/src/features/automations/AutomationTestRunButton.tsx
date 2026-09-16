import {useMemo} from "react"

import type {Automation} from "@agenta/automation-ui"
import {getScheduleMessagePreview} from "@agenta/entities/gatewayTrigger"
import {Button} from "@agenta/ui/ui"
import {Play} from "@phosphor-icons/react"

import {useStartTaskSession} from "../chat/useStartTaskSession"

/**
 * Run this automation now, without waiting for its trigger.
 *
 * It opens a NEW session with the bound agent and sends the automation's instruction as the
 * first turn — the same hand-off Home's composer uses, so the run is under way by the time the
 * chat is on screen. A test run is a run: the reader came to see what the automation does, not
 * to be handed its text to send.
 *
 * Not the shared `RunSubscriptionButton`: that publishes to `simulatedAgentRunAtomFamily`, which
 * only the desktop playground reads, so on this surface it would silently do nothing.
 *
 * Disabled with a reason rather than hidden — "why can't I test this" is a question the control
 * itself should answer.
 */
export const AutomationTestRunButton = ({
    automation,
    base,
    dirty,
}: {
    automation: Automation
    /** `/w/:workspace/p/:project` */
    base: string
    /** Unsaved config edits — a test run would exercise a version that does not exist yet. */
    dirty: boolean
}) => {
    const startTask = useStartTaskSession(base)

    // Shape-agnostic: the message is read straight off the stored inputs, so no agent schema has
    // to resolve before the button can be pressed.
    const instruction = useMemo(
        () => getScheduleMessagePreview(automation.raw.data?.inputs_fields).trim(),
        [automation.raw.data?.inputs_fields],
    )

    const blockedReason = testRunBlockedReason({agentId: automation.agentId, instruction, dirty})

    return (
        // A disabled button takes no pointer events, so the reason has to hang off something that
        // does.
        <span title={blockedReason || undefined}>
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-xs font-normal"
                disabled={Boolean(blockedReason)}
                title={blockedReason || "Run this automation now in a new session"}
                onClick={() => {
                    if (!automation.agentId) return
                    void startTask(automation.agentId, instruction)
                }}
            >
                <Play aria-hidden className="size-3" />
                Test run
            </Button>
        </span>
    )
}

/**
 * Why a test run cannot start, or "" when it can. Shared with the list row's menu action so
 * the two entry points refuse for the same reasons in the same words.
 */
export const testRunBlockedReason = ({
    agentId,
    instruction,
    dirty = false,
}: {
    agentId: string | null
    instruction: string
    dirty?: boolean
}): string => {
    if (!agentId) return "Pick the agent this automation runs first"
    // The run IS the instruction; with none there is nothing to send.
    if (!instruction) return "Add an instruction to test this automation"
    if (dirty) return "Save your changes first — a test run uses the saved automation"
    return ""
}
