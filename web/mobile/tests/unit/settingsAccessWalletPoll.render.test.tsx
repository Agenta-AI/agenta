// @vitest-environment jsdom
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useMobileSettingsAccess} from "@/features/settings/settingsTabs"

const api = vi.hoisted(() => ({summary: vi.fn()}))

vi.mock("@/features/wallet/walletApi", async (original) => ({
    ...(await original<object>()),
    fetchWalletSummary: api.summary,
}))
vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const runtime = globalThis as typeof globalThis & {__env?: Record<string, string>}

const Probe = () => {
    const {walletEnforced} = useMobileSettingsAccess()
    return <span>{walletEnforced ? "enforced" : "not enforced"}</span>
}

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
    vi.useFakeTimers()
    runtime.__env = {NEXT_PUBLIC_AGENTA_WALLETS_ENABLED: "true"}
    api.summary.mockResolvedValue({mode: "enforce", spendable_musd: 0, credits: []})
})
afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
    delete runtime.__env
    api.summary.mockReset()
    vi.useRealTimers()
})

describe("useMobileSettingsAccess", () => {
    it("reads the wallet mode once and does not poll it", async () => {
        host = document.createElement("div")
        root = createRoot(host)
        const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
        await act(async () => {
            root!.render(
                <QueryClientProvider client={client}>
                    <Probe />
                </QueryClientProvider>,
            )
        })
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60_000)
        })

        expect(host.textContent).toBe("enforced")
        expect(api.summary.mock.calls).toEqual([["proj-1"]])
    })
})
