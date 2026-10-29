import type {Automation} from "@agenta/automation-ui"
import {
    getScheduleMessagePreview,
    latestDeliveryEvent,
    parseMessageTemplate,
    queryTriggerDeliveries,
    renderMessagePreview,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"

/**
 * The text Run now sends: for an event automation, the same text the instruction preview shows,
 * with pills filled from the newest recorded event. Rejects when the deliveries call fails, so
 * the caller can refuse to start rather than send a guess.
 */
export async function runNowText(
    automation: Automation,
    queryDeliveries: typeof queryTriggerDeliveries = queryTriggerDeliveries,
): Promise<string> {
    const inputs = automation.raw.data?.inputs_fields
    const today = getScheduleMessagePreview(inputs).trim()
    if (automation.kind !== "event" || !inputs || typeof inputs !== "object") return today
    // Run now has no agent schema; only a `messages` mapping reads the same without one.
    if (!Array.isArray((inputs as Record<string, unknown>).messages)) return today
    const template = parseMessageTemplate(JSON.stringify(inputs), true, "messages")
    if (template === null) return today

    const {deliveries} = await queryDeliveries({subscription_id: automation.id})
    const includeEvent = (automation.raw as TriggerSubscription).data?.include_event ?? true
    return renderMessagePreview(template, latestDeliveryEvent(deliveries), includeEvent).trim()
}
