/** The subscription row's "Run in playground" flask + its event-source picker wiring. */
import {useCallback, useState} from "react"

import {getScheduleMessagePreview} from "@agenta/entities/gatewayTrigger"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {message} from "@agenta/ui"
import {Flask} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useSetAtom} from "jotai"

import {
    loadRecentSamples,
    waitForNewDelivery,
} from "../../../gatewayTrigger/drawers/shared/deliveries"
import {
    EventSourcePicker,
    type SampledEvent,
} from "../../../gatewayTrigger/drawers/shared/EventSourcePicker"

/**
 * The subscription row's "Run in playground" flask — opens the EventSourcePicker (wait for a
 * new event / pick a recent delivery) so the user runs a SPECIFIC real event, instead of
 * silently replaying whatever delivery happened to be latest.
 */
export function SubscriptionRunPopover({
    subscriptionId,
    label,
    eventKey,
    playgroundEntityId,
    disabled,
}: {
    subscriptionId: string
    label: string
    eventKey?: string
    playgroundEntityId: string | null
    disabled?: boolean
}) {
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId ?? ""))
    const [recent, setRecent] = useState<SampledEvent[]>([])

    const refresh = useCallback(async () => {
        try {
            setRecent(await loadRecentSamples(subscriptionId, label))
        } catch {
            message.error("Couldn't load recent events")
        }
    }, [subscriptionId, label])

    const waitForEvent = useCallback(async () => {
        let result: Awaited<ReturnType<typeof waitForNewDelivery>>
        try {
            result = await waitForNewDelivery(subscriptionId, label)
        } catch {
            message.error("Couldn't check for new events")
            return null
        }
        if (!result) {
            message.info("No event arrived yet — trigger it from the app, then try again.")
            return null
        }
        setRecent(result.recent)
        return result.sample
    }, [subscriptionId, label])

    const run = useCallback(
        (event: SampledEvent) => {
            if (!playgroundEntityId) {
                message.info("Open this agent in the playground first")
                return
            }
            const inputs =
                event.payload && typeof event.payload === "object"
                    ? (event.payload as Record<string, unknown>)
                    : {}
            const msg = getScheduleMessagePreview(inputs)
            const text = msg.trim()
                ? msg
                : `[Triggered by ${label}${eventKey ? ` · ${eventKey}` : ""}]\n\`\`\`json\n${JSON.stringify(
                      inputs,
                      null,
                      2,
                  )}\n\`\`\``
            setPendingRun({text, nonce: Date.now(), newSession: true})
            message.success("Running in playground")
        },
        [playgroundEntityId, setPendingRun, label, eventKey],
    )

    return (
        <EventSourcePicker
            placement="bottomRight"
            autoWaitOnOpen
            onOpenChange={(open) => open && refresh()}
            trigger={
                <Tooltip title="Run in playground">
                    <Button
                        type="text"
                        icon={<Flask size={16} />}
                        aria-label="Run in playground"
                        disabled={disabled}
                        onClick={(e) => e.stopPropagation()}
                    />
                </Tooltip>
            }
            recentEvents={recent}
            onPick={run}
            onWaitForEvent={waitForEvent}
            waitHint="trigger it from the app now"
        />
    )
}
