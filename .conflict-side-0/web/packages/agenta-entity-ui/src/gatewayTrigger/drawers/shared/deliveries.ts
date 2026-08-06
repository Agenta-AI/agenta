/**
 * Shared helpers for turning a subscription's real deliveries into samples for the
 * EventSourcePicker (wait-for-event / pick-a-recent). Used by the subscription drawer's
 * mapping picker and the config-section list's "Run in playground" picker so both source a
 * SPECIFIC real event instead of guessing the latest delivery.
 */
import {getScheduleMessagePreview, queryTriggerDeliveries} from "@agenta/entities/gatewayTrigger"
import type {TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {dayjs} from "@agenta/shared/utils"

import type {SampledEvent} from "./EventSourcePicker"

export function deliveryInputs(delivery: TriggerDelivery): Record<string, unknown> {
    return (delivery.data?.inputs ?? delivery.data ?? {}) as Record<string, unknown>
}

export function hasInputs(delivery: TriggerDelivery): boolean {
    return Object.keys(deliveryInputs(delivery)).length > 0
}

function deliveryTime(delivery: TriggerDelivery): number {
    const t = delivery.created_at ? new Date(delivery.created_at).getTime() : NaN
    return Number.isNaN(t) ? 0 : t
}

/** The endpoint isn't guaranteed newest-first; sort then take the latest few with inputs. */
export function recentWithInputs(deliveries: TriggerDelivery[]): TriggerDelivery[] {
    return [...deliveries]
        .filter(hasInputs)
        .sort((a, b) => deliveryTime(b) - deliveryTime(a))
        .slice(0, 3)
}

export function deliveryToSample(delivery: TriggerDelivery, label: string): SampledEvent {
    const payload = deliveryInputs(delivery)
    return {
        id: delivery.id ?? "delivery",
        label,
        preview: getScheduleMessagePreview(payload) || undefined,
        timeAgo: delivery.created_at
            ? dayjs(delivery.created_at).format("MMM D, HH:mm")
            : undefined,
        payload,
    }
}

/** Recent deliveries (with inputs) for a subscription, as picker samples. */
export async function loadRecentSamples(
    subscriptionId: string,
    label: string,
): Promise<SampledEvent[]> {
    const {deliveries} = await queryTriggerDeliveries({subscription_id: subscriptionId})
    return recentWithInputs(deliveries).map((d) => deliveryToSample(d, label))
}

/**
 * Poll a subscription's own deliveries until one arrives AFTER the call starts (a saved sub
 * already occupies its provider trigger, so re-running /test would collide). Returns the fresh
 * sample + refreshed recent list, or null on timeout.
 */
export async function waitForNewDelivery(
    subscriptionId: string,
    label: string,
    opts?: {timeoutMs?: number; intervalMs?: number},
): Promise<{sample: SampledEvent; recent: SampledEvent[]} | null> {
    const {deliveries: baseline} = await queryTriggerDeliveries({subscription_id: subscriptionId})
    const seen = new Set(baseline.map((d) => d.id))
    const deadline = Date.now() + (opts?.timeoutMs ?? 120_000)
    while (Date.now() < deadline) {
        const {deliveries} = await queryTriggerDeliveries({subscription_id: subscriptionId})
        const fresh = deliveries.filter(hasInputs).find((d) => !seen.has(d.id))
        if (fresh) {
            return {
                sample: deliveryToSample(fresh, label),
                recent: recentWithInputs(deliveries).map((d) => deliveryToSample(d, label)),
            }
        }
        await new Promise((resolve) => setTimeout(resolve, opts?.intervalMs ?? 2000))
    }
    return null
}
