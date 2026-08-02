/** The subscription drawer's footer run-in-playground CTA. */
import {useCallback} from "react"

import {getScheduleMessagePreview} from "@agenta/entities/gatewayTrigger"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {Lightning} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useSetAtom} from "jotai"

import {EventSourcePicker, type SampledEvent} from "../shared/EventSourcePicker"

// ---------------------------------------------------------------------------
// RunSubscriptionButton — footer run-in-playground. A subscription has no static
// payload, so it sources a real event (EventSourcePicker: wait / recent) and runs
// the agent with it. Disabled until the subscription is saved.
// ---------------------------------------------------------------------------

export function RunSubscriptionButton({
    playgroundEntityId,
    name,
    eventKey,
    disabled,
    onClose,
}: {
    playgroundEntityId: string
    name: string
    eventKey: string
    disabled?: boolean
    onClose: () => void
}) {
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId))

    const run = useCallback(
        (event: SampledEvent) => {
            const label = name || eventKey || "Trigger"
            const preview = getScheduleMessagePreview(event.payload)
            const text = preview
                ? preview
                : `[Trigger · ${label}]\n\`\`\`json\n${JSON.stringify(event.payload ?? {}, null, 2)}\n\`\`\``
            setPendingRun({text, nonce: Date.now(), newSession: true})
            onClose()
        },
        [name, eventKey, setPendingRun, onClose],
    )

    if (disabled) {
        return (
            <Tooltip title="Create the trigger first to run it">
                <span>
                    <Button icon={<Lightning size={14} />} disabled>
                        Run in playground
                    </Button>
                </span>
            </Tooltip>
        )
    }

    return (
        <EventSourcePicker
            placement="topRight"
            trigger={<Button icon={<Lightning size={14} />}>Run in playground</Button>}
            recentEvents={[]}
            onPick={run}
        />
    )
}
