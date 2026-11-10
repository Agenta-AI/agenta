// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {CreditsRemainingWidget} from "@/features/wallet/CreditsRemainingWidget"

const api = vi.hoisted(() => ({summary: vi.fn()}))

vi.mock("@/features/wallet/walletApi", async (original) => ({
    ...(await original<object>()),
    fetchWalletSummary: api.summary,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const runtime = globalThis as typeof globalThis & {__env?: Record<string, string>}

let report: (isIntersecting: boolean) => void = () => undefined

class FakeIntersectionObserver {
    constructor(callback: (entries: {isIntersecting: boolean}[]) => void) {
        report = (isIntersecting) => callback([{isIntersecting}])
    }
    observe() {
        return undefined
    }
    disconnect() {
        report = () => undefined
    }
}

let root: Root | undefined
let host: HTMLDivElement | undefined

const renderWidget = async () => {
    host = document.createElement("div")
    root = createRoot(host)
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CreditsRemainingWidget projectId="proj-1" settingsURL="/s" collapsed={false} />
            </QueryClientProvider>,
        )
    })
}

const idle = (ms: number) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)
    runtime.__env = {NEXT_PUBLIC_AGENTA_WALLETS_ENABLED: "true"}
    api.summary.mockResolvedValue({
        mode: "enforce",
        spendable_musd: 2_000,
        active_credit_total_musd: 4_000,
        credits: [
            {
                id: "c1",
                credit_kind: "purchase",
                amount_musd: 4_000,
                remaining_musd: 2_000,
                start_time: null,
                end_time: null,
                created_at: null,
            },
        ],
    })
})
afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
    delete runtime.__env
    api.summary.mockReset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("CreditsRemainingWidget", () => {
    it("reads once while hidden, polls while on screen, and stops when hidden again", async () => {
        await renderWidget()
        await idle(60_000)
        expect(api.summary.mock.calls.length).toBe(1)
        expect(host!.textContent).toContain("Credits remaining")

        await act(async () => report(true))
        await idle(30_000)
        expect(api.summary.mock.calls.length).toBe(4)

        await act(async () => report(false))
        await idle(60_000)
        expect(api.summary.mock.calls.length).toBe(4)
    })

    it("polls once a minute on screen while the balance is healthy", async () => {
        api.summary.mockResolvedValue({
            mode: "enforce",
            spendable_musd: 40_000_000,
            active_credit_total_musd: 50_000_000,
            credits: [
                {
                    id: "c1",
                    credit_kind: "purchase",
                    amount_musd: 50_000_000,
                    remaining_musd: 40_000_000,
                    start_time: null,
                    end_time: null,
                    created_at: null,
                },
            ],
        })
        await renderWidget()
        await act(async () => report(true))
        await idle(30_000)
        expect(api.summary.mock.calls.length).toBe(1)

        await idle(35_000)
        expect(api.summary.mock.calls.length).toBe(2)
    })
})
