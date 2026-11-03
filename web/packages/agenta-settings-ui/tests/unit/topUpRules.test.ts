import {describe, expect, it} from "vitest"

import {toTopUpOffer} from "../../src/billing/topups/api"
import {
    formatPackPrice,
    readTopUpReturn,
    topUpCheckoutError,
    topUpEntry,
    topUpReturnUrls,
    withoutTopUpQuery,
} from "../../src/billing/topups/topUpRules"

describe("topUpEntry", () => {
    it("offers the picker only where the organization can buy a pack", () => {
        expect(topUpEntry("available")).toBe("buy")
    })

    it("offers the upgrade path on the free plan", () => {
        expect(topUpEntry("paid_plan_required")).toBe("upgrade")
    })

    it("offers nothing while purchases are off or the answer is not in", () => {
        expect(topUpEntry("unavailable")).toBeNull()
        expect(topUpEntry(undefined)).toBeNull()
    })
})

describe("toTopUpOffer", () => {
    it("reads the packs the API lists", () => {
        expect(
            toTopUpOffer({
                status: "available",
                packs: [
                    {
                        code: "credits_1000",
                        credits: 1000,
                        price_cents: 1000,
                        currency: "usd",
                        expires_after_days: 365,
                    },
                ],
            }),
        ).toEqual({
            status: "available",
            packs: [
                {
                    code: "credits_1000",
                    credits: 1000,
                    priceCents: 1000,
                    currency: "usd",
                    expiresAfterDays: 365,
                },
            ],
        })
    })

    it("offers nothing on an answer it cannot read", () => {
        expect(toTopUpOffer({status: "sure", packs: [{code: 1}]})).toEqual({
            status: "unavailable",
            packs: [],
        })
        expect(toTopUpOffer(null)).toEqual({status: "unavailable", packs: []})
    })
})

describe("return URLs", () => {
    it("come back to the same page with the result and Stripe's session placeholder", () => {
        const {successUrl, cancelUrl} = topUpReturnUrls(
            "https://app.example/m/w/ws/p/pr/settings?tab=credits&topup=cancelled&buy_credits=1#x",
        )

        expect(successUrl).toBe(
            "https://app.example/m/w/ws/p/pr/settings?tab=credits&topup=success&topup_session={CHECKOUT_SESSION_ID}",
        )
        expect(cancelUrl).toBe(
            "https://app.example/m/w/ws/p/pr/settings?tab=credits&topup=cancelled",
        )
    })

    it("are read back from the router query", () => {
        expect(readTopUpReturn({topup: "success", topup_session: "cs_test_1"})).toEqual({
            result: "success",
            sessionId: "cs_test_1",
        })
        expect(readTopUpReturn({topup: "cancelled"})).toEqual({result: "cancelled"})
        expect(readTopUpReturn({topup: "success"})).toEqual({result: "success", sessionId: null})
        // Stripe did not substitute the placeholder: there is no session to match.
        expect(readTopUpReturn({topup: "success", topup_session: "{CHECKOUT_SESSION_ID}"})).toEqual(
            {result: "success", sessionId: null},
        )
        expect(readTopUpReturn({tab: "credits"})).toBeNull()
    })

    it("are cleared from the query, other keys kept", () => {
        expect(
            withoutTopUpQuery({
                tab: "credits",
                topup: "success",
                topup_session: "cs",
                buy_credits: "1",
            }),
        ).toEqual({tab: "credits"})
    })
})

describe("topUpCheckoutError", () => {
    const failure = (status: number, detail?: string) => ({response: {status, data: {detail}}})

    it("tells the free plan, no permission, purchases off and other failures apart", () => {
        expect(topUpCheckoutError(failure(400, "Credit top-ups need a paid plan"))).toBe(
            "paid_plan_required",
        )
        expect(topUpCheckoutError(failure(403))).toBe("forbidden")
        expect(topUpCheckoutError(failure(404))).toBe("unavailable")
        expect(topUpCheckoutError(failure(502))).toBe("failed")
        expect(topUpCheckoutError(new Error("network"))).toBe("failed")
    })
})

describe("formatPackPrice", () => {
    it("shows whole dollars without cents", () => {
        expect(formatPackPrice(1000, "usd")).toBe("$10")
        expect(formatPackPrice(1250, "usd")).toBe("$12.50")
    })
})
