/**
 * The credit top-up endpoints: the packs on offer (and whether this organization can buy one
 * now), the Stripe Checkout hand-off, and whether a paid checkout has been credited.
 *
 * Raw axios, as in `../api.ts`: the generated client has no top-up or wallet methods yet.
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"

/**
 * `available`: the organization can buy a pack now. `paid_plan_required`: the free plan, or no
 * Stripe subscription. `unavailable`: the wallet is off or not enforced for the organization, or
 * Stripe is not configured. The pack list and the checkout answer from the same rule.
 */
export type TopUpStatus = "available" | "paid_plan_required" | "unavailable"

export interface TopUpPack {
    code: string
    credits: number
    priceCents: number
    currency: string
    /** Purchased credits expire this many days after the payment. */
    expiresAfterDays: number
}

export interface TopUpOffer {
    status: TopUpStatus
    packs: TopUpPack[]
}

const STATUSES: readonly TopUpStatus[] = ["available", "paid_plan_required", "unavailable"]

const toPack = (raw: unknown): TopUpPack | null => {
    const pack = raw as Record<string, unknown> | null
    if (
        !pack ||
        typeof pack.code !== "string" ||
        typeof pack.credits !== "number" ||
        typeof pack.price_cents !== "number"
    )
        return null
    return {
        code: pack.code,
        credits: pack.credits,
        priceCents: pack.price_cents,
        currency: typeof pack.currency === "string" ? pack.currency : "usd",
        expiresAfterDays: typeof pack.expires_after_days === "number" ? pack.expires_after_days : 0,
    }
}

/** An answer this view cannot read counts as `unavailable`, so nothing is offered on a guess. */
export const toTopUpOffer = (data: unknown): TopUpOffer => {
    const body = data as {status?: unknown; packs?: unknown} | null
    const status = STATUSES.find((value) => value === body?.status) ?? "unavailable"
    const packs = Array.isArray(body?.packs)
        ? body.packs.map(toPack).filter((pack): pack is TopUpPack => pack !== null)
        : []
    return {status, packs}
}

export const fetchTopUpOffer = async (projectId: string): Promise<TopUpOffer> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/billing/stripe/topups/packs`, {
        params: {project_id: projectId},
    })
    return toTopUpOffer(data)
}

/** Returns the Stripe Checkout URL to send the payer to. */
export const createTopUpCheckout = async ({
    projectId,
    pack,
    successUrl,
    cancelUrl,
}: {
    projectId: string
    pack: string
    successUrl: string
    cancelUrl: string
}): Promise<string | null> => {
    const {data} = await axios.post(`${getAgentaApiUrl()}/billing/stripe/topups/`, null, {
        params: {
            project_id: projectId,
            pack,
            success_url: successUrl,
            cancel_url: cancelUrl,
        },
    })
    return typeof data?.checkout_url === "string" ? data.checkout_url : null
}

export interface TopUpPurchase {
    /** Whether the payment event has arrived and granted the pack. */
    credited: boolean
    credits: number | null
}

/** Whether the top-up paid in this Checkout session has been credited yet. */
export const fetchTopUpPurchase = async (
    projectId: string,
    checkoutSessionId: string,
): Promise<TopUpPurchase> => {
    const {data} = await axios.get(
        `${getAgentaApiUrl()}/billing/stripe/topups/${encodeURIComponent(checkoutSessionId)}`,
        {params: {project_id: projectId}},
    )
    return {
        credited: data?.credited === true,
        credits: typeof data?.credits === "number" ? data.credits : null,
    }
}
