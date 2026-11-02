import type {Automation} from "@agenta/automation-ui"
import {
    addsEventText,
    getScheduleMessagePreview,
    includesEvent,
    latestDeliveryEvent,
    parseMessageTemplate,
    queryTriggerDeliveries,
    renderMessagePreview,
    type TriggerDeliveriesResponse,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"

/**
 * The text Run now sends: for an event automation, the same text the instruction preview shows,
 * with pills filled from the newest recorded event. Null when the deliveries call fails, so the
 * caller starts nothing rather than send a guess.
 */
export async function runNowText(
    automation: Automation,
    queryDeliveries: typeof queryTriggerDeliveries = queryTriggerDeliveries,
): Promise<string | null> {
    const inputs = automation.raw.data?.inputs_fields
    const today = getScheduleMessagePreview(inputs).trim()
    // Run now has no agent schema; only a `messages` mapping reads the same without one.
    if (automation.kind !== "event" || !addsEventText(inputs)) return today
    const template = parseMessageTemplate(JSON.stringify(inputs), true, "messages")
    if (template === null) return today

    let response: TriggerDeliveriesResponse
    try {
        response = await queryDeliveries({subscription_id: automation.id})
    } catch (error) {
        console.error("[runNowText] deliveries query failed", error)
        return null
    }
    const includeEvent = includesEvent((automation.raw as TriggerSubscription).data)
    return renderMessagePreview(
        template,
        latestDeliveryEvent(response.deliveries),
        includeEvent,
    ).trim()
}
