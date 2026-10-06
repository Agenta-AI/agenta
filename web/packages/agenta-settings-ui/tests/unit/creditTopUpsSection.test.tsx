// @vitest-environment jsdom
import React, {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const api = vi.hoisted(() => ({
    fetchTopUpOffer: vi.fn(),
    fetchTopUpPurchase: vi.fn(),
    createTopUpCheckout: vi.fn(),
}))
vi.mock("../../src/billing/topups/api", () => api)

import {CreditTopUpsSection} from "../../src/billing/topups/CreditTopUpsSection"
import type {TopUpReturn} from "../../src/billing/topups/topUpRules"

const PACKS = [
    {code: "credits_1000", credits: 1000, priceCents: 1000, currency: "usd", expiresAfterDays: 365},
    {code: "credits_2500", credits: 2500, priceCents: 2500, currency: "usd", expiresAfterDays: 365},
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const flush = async () => {
    for (let index = 0; index < 5; index += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
}

const render = async (
    props: {topUpReturn?: TopUpReturn; onUpgrade?: () => void; onQueryHandled?: () => void} = {},
) => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    act(() => root.unmount())
    root = createRoot(container)
    act(() =>
        root.render(
            <QueryClientProvider client={client}>
                <CreditTopUpsSection
                    projectId="project-1"
                    topUpReturn={props.topUpReturn ?? null}
                    onUpgrade={props.onUpgrade}
                    onQueryHandled={props.onQueryHandled}
                />
            </QueryClientProvider>,
        ),
    )
    await flush()
    return container.textContent ?? ""
}

describe("CreditTopUpsSection", () => {
    it("offers Buy credits to an organization that can buy a pack", async () => {
        api.fetchTopUpOffer.mockResolvedValue({status: "available", packs: PACKS})

        const text = await render()

        expect(text).toContain("Buy credits")
        expect(text).toContain("expire 365 days after purchase")
        expect(text).not.toContain("Upgrade")
    })

    it("offers Upgrade instead on the free plan", async () => {
        api.fetchTopUpOffer.mockResolvedValue({status: "paid_plan_required", packs: PACKS})

        const text = await render({onUpgrade: () => undefined})

        expect(text).toContain("Credit packs are available on paid plans.")
        expect(text).toContain("Upgrade")
        expect(container.querySelector("button")?.textContent).toBe("Upgrade")
    })

    it("renders nothing while purchases are off", async () => {
        api.fetchTopUpOffer.mockResolvedValue({status: "unavailable", packs: PACKS})

        expect(await render()).toBe("")
    })

    it("renders nothing for a member without billing access", async () => {
        api.fetchTopUpOffer.mockRejectedValue({response: {status: 403}})

        expect(await render()).toBe("")
    })

    it("reports a cancelled checkout and hands the URL back to the host", async () => {
        api.fetchTopUpOffer.mockResolvedValue({status: "available", packs: PACKS})
        const onQueryHandled = vi.fn()

        const text = await render({topUpReturn: {result: "cancelled"}, onQueryHandled})

        expect(text).toContain("Checkout cancelled. You were not charged.")
        expect(onQueryHandled).toHaveBeenCalled()
    })

    it("waits for this checkout's purchase, then says it landed", async () => {
        api.fetchTopUpOffer.mockResolvedValue({status: "available", packs: PACKS})
        api.fetchTopUpPurchase.mockResolvedValue({credited: false, credits: null})

        const waiting = await render({topUpReturn: {result: "success", sessionId: "cs_test_1"}})
        expect(waiting).toContain("Payment received")
        expect(waiting).toContain("Your credits will appear here shortly.")
        expect(api.fetchTopUpPurchase).toHaveBeenCalledWith("project-1", "cs_test_1")

        api.fetchTopUpPurchase.mockResolvedValue({credited: true, credits: 2500})
        await render({topUpReturn: {result: "success", sessionId: "cs_test_1"}})

        expect(container.textContent).toContain("Credits added")
        expect(container.textContent).toContain("2,500 purchased credits are now available.")
    })

    it("offers to check again after the wait runs out", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true})
        try {
            api.fetchTopUpOffer.mockResolvedValue({status: "available", packs: PACKS})
            api.fetchTopUpPurchase.mockResolvedValue({credited: false, credits: null})

            await render({topUpReturn: {result: "success", sessionId: "cs_test_2"}})
            await act(async () => {
                vi.advanceTimersByTime(2 * 60_000 + 1)
            })
            await flush()

            expect(container.textContent).toContain("The credits have not appeared yet.")
            const check = [...container.querySelectorAll("button")].find(
                (button) => button.textContent === "Check again",
            )
            expect(check).toBeTruthy()

            api.fetchTopUpPurchase.mockResolvedValue({credited: true, credits: 1000})
            await act(async () => check!.click())
            await flush()

            expect(container.textContent).toContain("1,000 purchased credits are now available.")
        } finally {
            vi.useRealTimers()
        }
    })
})
