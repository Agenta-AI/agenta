// @vitest-environment jsdom
//
// The credits view people see once their organization's wallet is enforced: the sidebar meter
// and the Credits tab. Both read credits (1 credit = 1 cent), not micro-dollars, and neither
// shows for an organization the wallet does not enforce.
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {CreditsRemainingWidget} from "@/features/wallet/CreditsRemainingWidget"
import {CreditsTab} from "@/features/wallet/CreditsTab"
import type {WalletSummary, WalletUsage} from "@/features/wallet/walletApi"

const api = vi.hoisted(() => ({
    summary: vi.fn(),
    usage: vi.fn(),
}))

vi.mock("@/features/wallet/walletApi", () => ({
    fetchWalletSummary: api.summary,
    fetchWalletUsage: api.usage,
}))
vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const runtime = globalThis as typeof globalThis & {__env?: Record<string, string>}

const summary = (mode: WalletSummary["mode"]): WalletSummary => ({
    mode,
    spendable_musd: 12_345_000,
    general_balance_musd: 12_345_000,
    floor_musd: 0,
    active_credit_total_musd: 50_000_000,
    credits: [
        {
            id: "c-1",
            credit_kind: "signup_grant",
            amount_musd: 50_000_000,
            remaining_musd: 12_345_000,
            priority: 10,
            start_time: null,
            end_time: "2027-10-02T00:00:00Z",
            created_at: "2026-10-02T00:00:00Z",
        },
    ],
})

// An organization refused at signup: 75 daily credits under a 100-credit floor. Admission
// refuses every turn, so the API reports nothing spendable.
const flooredSummary = (): WalletSummary => ({
    mode: "enforce",
    spendable_musd: 0,
    general_balance_musd: 750_000,
    floor_musd: 1_000_000,
    active_credit_total_musd: 750_000,
    credits: [
        {
            id: "c-daily",
            credit_kind: "daily_free",
            amount_musd: 750_000,
            remaining_musd: 750_000,
            priority: 10,
            start_time: null,
            end_time: "2099-01-01T00:00:00Z",
            created_at: "2026-10-14T00:00:00Z",
        },
    ],
})

// Yesterday, so the day always falls inside the chart's default 30-day range.
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

const usage: WalletUsage = {
    start: "2026-09-02T00:00:00Z",
    end: "2026-10-02T00:00:00Z",
    truncated: false,
    days: [
        {day: yesterday, category: "AI models", amount_musd: 1_000_000, charge_count: 3},
        {day: yesterday, category: "Runtime", amount_musd: 250_000, charge_count: 2},
    ],
    sessions: [],
}

let root: Root | undefined
let host: HTMLDivElement | undefined

// jsdom has neither; the usage chart reads both.
window.matchMedia ??= vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia
globalThis.ResizeObserver ??= class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
} as unknown as typeof ResizeObserver

beforeEach(() => {
    runtime.__env = {NEXT_PUBLIC_AGENTA_WALLETS_ENABLED: "true"}
})
afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host = undefined
    delete runtime.__env
    api.summary.mockReset()
    api.usage.mockReset()
})

const render = async (node: React.ReactNode): Promise<string> => {
    host = document.createElement("div")
    root = createRoot(host)
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    await act(async () => {
        root!.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
    })
    // Two rounds: the usage query starts only once the summary has answered.
    for (let round = 0; round < 2; round += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

describe("the sidebar credits meter", () => {
    it("shows credits left where the wallet is enforced", async () => {
        api.summary.mockResolvedValue(summary("enforce"))
        const shown = await render(
            <CreditsRemainingWidget projectId="proj-1" settingsURL="/settings" collapsed={false} />,
        )

        expect(shown).toContain("Credits remaining")
        expect(shown).toContain("1,234.5 of 5,000")
        expect(host!.querySelector("a")?.getAttribute("href")).toBe("/settings?tab=credits")
    })

    it("shows 0 left when the balance is under the floor", async () => {
        api.summary.mockResolvedValue(flooredSummary())
        const shown = await render(
            <CreditsRemainingWidget projectId="proj-1" settingsURL="/settings" collapsed={false} />,
        )

        expect(shown).toContain("0 of 75")
        expect(host!.querySelector(".bg-primary")?.getAttribute("style")).toContain("width: 0%")
    })

    it.each(["shadow", "off"] as const)("is hidden in %s mode", async (mode) => {
        api.summary.mockResolvedValue(summary(mode))
        const shown = await render(
            <CreditsRemainingWidget projectId="proj-1" settingsURL="/settings" collapsed={false} />,
        )

        expect(shown).toBe("")
    })
    it("does not read the summary while the sidebar is collapsed", async () => {
        api.summary.mockResolvedValue(summary("enforce"))
        const shown = await render(
            <CreditsRemainingWidget projectId="proj-1" settingsURL="/settings" collapsed />,
        )

        expect(shown).toBe("")
        expect(api.summary).not.toHaveBeenCalled()
    })
})

describe("the Credits tab", () => {
    it("shows the balance, the credits behind it, and credits used in the range", async () => {
        api.summary.mockResolvedValue(summary("enforce"))
        api.usage.mockResolvedValue(usage)
        const shown = await render(<CreditsTab projectId="proj-1" />)

        expect(shown).toContain("Signup bonus")
        expect(shown).toContain("1,234.5")
        expect(shown).toContain("of 5,000")
        expect(shown).toContain("Valid until Oct 2, 2027")
        expect(shown).toContain("125.0 credits · $1.25")
        expect(shown).toContain("AI models 100.0 · 80%")
        expect(shown).toContain("Runtime 25.0 · 20%")
    })

    it("shows 0 credits when the balance is under the floor", async () => {
        api.summary.mockResolvedValue(flooredSummary())
        api.usage.mockResolvedValue(usage)
        const shown = await render(<CreditsTab projectId="proj-1" billingURL="/billing" />)

        expect(shown).toContain("Credits remaining")
        // The headline is the amount admission allows, not the credits under the floor.
        expect(host!.querySelector(".text-2xl")?.textContent).toBe("0 credits")
    })

    it("lists only credits inside their active window", async () => {
        const wallet = summary("enforce")
        wallet.credits.push({
            ...wallet.credits[0],
            id: "c-2",
            credit_kind: "expired_grant",
            end_time: "2020-01-01T00:00:00Z",
        })
        api.summary.mockResolvedValue(wallet)
        api.usage.mockResolvedValue(usage)
        const shown = await render(<CreditsTab projectId="proj-1" />)

        expect(shown).toContain("Signup bonus")
        expect(shown).not.toContain("Expired grant")
    })

    it("lists bought packs with what is left of them", async () => {
        const wallet = summary("enforce")
        wallet.credits.push({
            ...wallet.credits[0],
            id: "c-3",
            credit_kind: "purchase",
            amount_musd: 25_000_000,
            remaining_musd: 0,
            end_time: "2027-10-02T00:00:00Z",
        })
        api.summary.mockResolvedValue(wallet)
        api.usage.mockResolvedValue(usage)
        const shown = await render(<CreditsTab projectId="proj-1" />)

        expect(shown).toContain("2,500 credits")
        expect(shown).toContain("$25.00")
        expect(shown).toContain("Used up")
    })

    it("reads nothing for an organization the wallet does not enforce", async () => {
        api.summary.mockResolvedValue(summary("shadow"))
        const shown = await render(<CreditsTab projectId="proj-1" />)

        expect(shown).toBe("Credits are not in use for this organization.")
        expect(api.usage).not.toHaveBeenCalled()
    })

    it("tells a member who is not the owner that usage detail is the owner's", async () => {
        api.summary.mockResolvedValue(summary("enforce"))
        api.usage.mockRejectedValue(Object.assign(new Error("403"), {response: {status: 403}}))
        const shown = await render(<CreditsTab projectId="proj-1" />)

        expect(shown).toContain("1,234.5")
        expect(shown).toContain("Usage details are owner-only")
    })
})
