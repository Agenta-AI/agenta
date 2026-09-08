import {useMemo} from "react"

import {getScheduleMessagePreview} from "@agenta/entities/gatewayTrigger"
import {Play} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

import {useStartBlankSession} from "../chat/useStartBlankSession"

import type {Automation} from "./automationModel"

/**
 * Try this automation now, without waiting for its trigger.
 *
 * It opens a NEW session with the bound agent and the automation's instruction already in the
 * composer — unsent. A test run is a rehearsal, so the last press is still the user's: the
 * instruction can be read, corrected, and only then sent, which is also the only honest way to
 * test one whose message is empty.
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
    const startSession = useStartBlankSession(base)

    // Shape-agnostic: the message is read straight off the stored inputs, so no agent schema has
    // to resolve before the button can be pressed.
    const instruction = useMemo(
        () => getScheduleMessagePreview(automation.raw.data?.inputs_fields),
        [automation.raw.data?.inputs_fields],
    )

    const blockedReason = !automation.agentId
        ? "Pick the agent this automation runs first"
        : dirty
          ? "Save your changes first — a test run uses the saved automation"
          : ""

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
                title={blockedReason || "Open a session with this instruction, ready to send"}
                onClick={() => {
                    if (!automation.agentId) return
                    startSession(automation.agentId, {draft: instruction})
                }}
            >
                <Play aria-hidden className="size-3" />
                Test run
            </Button>
        </span>
    )
}
