/**
 * The pure rules of the top-up flow, kept apart from the components so they are tested alone:
 * what an organization is offered, the Stripe return URLs, reading the return, and the error
 * mapping.
 */

import type {TopUpStatus} from "./api"

/** What the app offers: the pack picker, the upgrade path, or nothing. */
export type TopUpEntry = "buy" | "upgrade" | null

export const topUpEntry = (status: TopUpStatus | undefined): TopUpEntry =>
    status === "available" ? "buy" : status === "paid_plan_required" ? "upgrade" : null

/** The query keys this flow puts on the return URLs, and the one that opens the picker. */
export const TOP_UP_QUERY = {
    result: "topup",
    session: "topup_session",
    open: "buy_credits",
} as const

/** Stripe replaces this placeholder in the success URL with the Checkout session's ID. */
const CHECKOUT_SESSION_PLACEHOLDER = "{CHECKOUT_SESSION_ID}"

/**
 * Stripe sends the payer back to the page they left, with the result on the URL. The success URL
 * carries the Checkout session, so the return screen confirms this purchase and no other.
 */
export const topUpReturnUrls = (currentHref: string): {successUrl: string; cancelUrl: string} => {
    const url = new URL(currentHref)
    for (const key of Object.values(TOP_UP_QUERY)) url.searchParams.delete(key)
    url.hash = ""

    const success = new URL(url)
    success.searchParams.set(TOP_UP_QUERY.result, "success")
    const cancel = new URL(url)
    cancel.searchParams.set(TOP_UP_QUERY.result, "cancelled")

    return {
        // Appended raw: Stripe matches the placeholder's literal braces, not their encoding.
        successUrl: `${success.toString()}&${TOP_UP_QUERY.session}=${CHECKOUT_SESSION_PLACEHOLDER}`,
        cancelUrl: cancel.toString(),
    }
}

export type TopUpReturn =
    | {result: "success"; sessionId: string | null}
    | {result: "cancelled"}
    | null

const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value

/** Reads the return from a router query. */
export const readTopUpReturn = (
    query: Record<string, string | string[] | undefined>,
): TopUpReturn => {
    const result = first(query[TOP_UP_QUERY.result])
    if (result === "cancelled") return {result: "cancelled"}
    if (result !== "success") return null
    const sessionId = first(query[TOP_UP_QUERY.session])
    return {
        result: "success",
        sessionId: sessionId && sessionId !== CHECKOUT_SESSION_PLACEHOLDER ? sessionId : null,
    }
}

/** The query with this flow's keys taken out, for the host to replace the URL with. */
export const withoutTopUpQuery = <T extends Record<string, unknown>>(query: T): Partial<T> => {
    const rest: Partial<T> = {...query}
    for (const key of Object.values(TOP_UP_QUERY)) delete rest[key as keyof T]
    return rest
}

/** How long the return screen waits for the credit before it says so. */
export const LANDING_TIMEOUT_MS = 2 * 60_000

export const LANDING_POLL_MS = 3_000

/** A pack's price for its card: "$10", "$12.50". */
export const formatPackPrice = (priceCents: number, currency: string): string =>
    (priceCents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
        minimumFractionDigits: priceCents % 100 ? 2 : 0,
        maximumFractionDigits: 2,
    })

export const formatCreditCount = (credits: number): string => credits.toLocaleString("en-US")

/** What a failed checkout call means for the person. */
export type TopUpCheckoutError = "paid_plan_required" | "unavailable" | "forbidden" | "failed"

export const topUpCheckoutError = (error: unknown): TopUpCheckoutError => {
    const response = (error as {response?: {status?: number; data?: {detail?: unknown}}} | null)
        ?.response
    if (response?.status === 403) return "forbidden"
    if (response?.status === 404) return "unavailable"
    if (response?.status === 400 && response.data?.detail === "Credit top-ups need a paid plan")
        return "paid_plan_required"
    return "failed"
}
