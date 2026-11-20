/** Run-in-playground wiring for a subscription row: recent samples, live capture, replay. */
import {useCallback, useState} from "react"

import {getScheduleMessagePreview} from "@agenta/entities/gatewayTrigger"
import {createT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {message} from "@agenta/ui"
import {useSetAtom} from "jotai"

import {
    loadRecentSamples,
    waitForNewDelivery,
} from "../../../gatewayTrigger/drawers/shared/deliveries"
import type {SampledEvent} from "../../../gatewayTrigger/drawers/shared/EventSourcePicker"

const t = createT(triggersCatalog)

/**
 * Sources a real event for a subscription and replays it in the playground — the data half of
 * the run affordance, shared by the row's "Run in playground" menu action. The event picker
 * (wait for a new event / pick a recent delivery) stays a presentational concern of the caller.
 */
export function useSubscriptionRun({
    subscriptionId,
    label,
    eventKey,
    playgroundEntityId,
}: {
    subscriptionId: string
    label: string
    eventKey?: string
    playgroundEntityId: string | null
}) {
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId ?? ""))
    const [recent, setRecent] = useState<SampledEvent[]>([])

    const refresh = useCallback(async () => {
        try {
            setRecent(await loadRecentSamples(subscriptionId, label))
        } catch {
            message.error(t("entityUi.triggers.couldNotLoadEvents"))
        }
    }, [subscriptionId, label])

    const waitForEvent = useCallback(async () => {
        let result: Awaited<ReturnType<typeof waitForNewDelivery>>
        try {
            result = await waitForNewDelivery(subscriptionId, label)
        } catch {
            message.error(t("entityUi.triggers.couldNotCheckEvents"))
            return null
        }
        if (!result) {
            message.info(t("entityUi.triggers.noEventYet"))
            return null
        }
        setRecent(result.recent)
        return result.sample
    }, [subscriptionId, label])

    const run = useCallback(
        (event: SampledEvent) => {
            if (!playgroundEntityId) {
                message.info(t("entityUi.triggers.openInPlaygroundFirst"))
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
            message.success(t("entityUi.triggers.startingRun"))
        },
        [playgroundEntityId, setPendingRun, label, eventKey],
    )

    return {recent, refresh, waitForEvent, run}
}
