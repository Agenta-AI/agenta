import type {TriggerDelivery} from "./types"

/** `data.event` of the newest delivery that recorded one, or null. Rows may arrive unsorted. */
export function latestDeliveryEvent(
    deliveries: readonly TriggerDelivery[],
): Record<string, unknown> | null {
    let newest: TriggerDelivery | null = null
    for (const delivery of deliveries) {
        if (!delivery.data?.event) continue
        if (!newest || (delivery.created_at ?? "") > (newest.created_at ?? "")) newest = delivery
    }
    return newest?.data?.event ?? null
}
