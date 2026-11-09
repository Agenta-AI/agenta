import {describe, expect, it} from "vitest"

import {creditAlert} from "@/features/wallet/creditAlert"
import type {WalletCredit, WalletSummary} from "@/features/wallet/walletApi"

const NOW = Date.parse("2026-11-08T12:00:00Z")
const CREDIT = 10_000

const credit = (overrides: Partial<WalletCredit>): WalletCredit => ({
    id: Math.random().toString(36),
    credit_kind: "purchase",
    amount_musd: 1000 * CREDIT,
    remaining_musd: 1000 * CREDIT,
    start_time: null,
    end_time: null,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
})

const daily = (day: string, remainingCredits = 0): WalletCredit =>
    credit({
        credit_kind: "daily_free",
        amount_musd: 75 * CREDIT,
        remaining_musd: remainingCredits * CREDIT,
        start_time: `${day}T00:00:00Z`,
        end_time: new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString(),
        created_at: `${day}T08:00:00Z`,
    })

const wallet = (credits: WalletCredit[], spendable?: number): WalletSummary => ({
    mode: "enforce",
    spendable_musd:
        spendable ??
        credits
            .filter((c) => !c.end_time || Date.parse(c.end_time) > NOW)
            .reduce((sum, c) => sum + c.remaining_musd, 0),
    active_credit_total_musd: 0,
    credits,
})

describe("creditAlert", () => {
    it("says nothing while the wallet is off", () => {
        expect(
            creditAlert({...wallet([credit({remaining_musd: 0})], 0), mode: "off"}, NOW),
        ).toEqual({kind: "none"})
        expect(creditAlert(undefined, NOW)).toEqual({kind: "none"})
    })

    it("says nothing on a healthy balance", () => {
        expect(creditAlert(wallet([credit({remaining_musd: 600 * CREDIT})]), NOW)).toEqual({
            kind: "none",
        })
    })

    it("warns under 20% of the durable total", () => {
        expect(creditAlert(wallet([credit({remaining_musd: 150 * CREDIT})]), NOW)).toEqual({
            kind: "low",
            remainingMusd: 1_500_000,
        })
    })

    it("warns from the spendable balance when the credit rows still look full", () => {
        expect(creditAlert(wallet([credit({})], 30 * CREDIT), NOW)).toEqual({
            kind: "low",
            remainingMusd: 300_000,
        })
    })

    it("does not count today's daily credits toward the durable balance", () => {
        const credits = [credit({}), daily("2026-11-08", 40)]
        expect(creditAlert(wallet(credits, 70 * CREDIT), NOW)).toEqual({
            kind: "low",
            remainingMusd: 300_000,
        })
        expect(creditAlert(wallet(credits, 40 * CREDIT), NOW)).toEqual({
            kind: "daily",
            todayMusd: 400_000,
            refills: true,
        })
    })

    it("reports today's daily credits once durable credits are spent", () => {
        const credits = [credit({remaining_musd: 0}), daily("2026-11-08", 40)]
        expect(creditAlert(wallet(credits), NOW)).toEqual({
            kind: "daily",
            todayMusd: 400_000,
            refills: true,
        })
    })

    it("stops promising a refill after ten daily grants this month", () => {
        const lateInMonth = Date.parse("2026-11-20T12:00:00Z")
        const credits = Array.from({length: 10}, (_, i) => daily(`2026-11-${11 + i}`, 0))
        credits[9] = daily("2026-11-20", 40)
        expect(creditAlert(wallet(credits, 400_000), lateInMonth)).toEqual({
            kind: "daily",
            todayMusd: 400_000,
            refills: false,
        })
    })

    it("treats a pending daily grant as daily, not empty", () => {
        const credits = [credit({remaining_musd: 0}), daily("2026-11-06"), daily("2026-11-07")]
        expect(creditAlert(wallet(credits, 0), NOW)).toEqual({
            kind: "daily",
            todayMusd: null,
            refills: true,
        })
    })

    it("follows the balance, not the credit rows, when the balance is at its floor", () => {
        const credits = [
            credit({remaining_musd: 50 * CREDIT}),
            daily("2026-11-06"),
            daily("2026-11-07"),
        ]
        expect(creditAlert(wallet(credits, 0), NOW)).toEqual({
            kind: "daily",
            todayMusd: null,
            refills: true,
        })
        expect(creditAlert(wallet([credit({remaining_musd: 50 * CREDIT})], 0), NOW)).toEqual({
            kind: "empty",
        })
    })

    it("is empty once today's daily grant is spent", () => {
        const credits = [credit({remaining_musd: 0}), daily("2026-11-08", 0)]
        expect(creditAlert(wallet(credits, 0), NOW)).toEqual({kind: "empty"})
    })

    it("keeps a daily-only organization out of the low ratio", () => {
        expect(creditAlert(wallet([daily("2026-11-08", 10)]), NOW)).toEqual({
            kind: "daily",
            todayMusd: 100_000,
            refills: true,
        })
    })
})
