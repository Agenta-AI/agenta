// The Plan & billing blocks that wait on the backend: each shows only once the API sends its
// field, and reads "no limit" the way the Members quota already does.
import type {BillingPlanOption, BillingUsage} from "@agenta/settings-ui"
import {describe, expect, it} from "vitest"

import {
    creditsLine,
    isRecommended,
    monthlyCredits,
    sharedFeatures,
    splitLead,
} from "@/features/settings/planCatalog"
import {planLimits} from "@/features/settings/planLimits"

const metric = (value: number, limit: number | null) => ({
    value,
    limit,
    free: 0,
    period: null,
    scope: "organization" as const,
    strict: true,
})

const plan = (extra: Partial<BillingPlanOption> = {}): BillingPlanOption => ({
    title: "Starter",
    description: "",
    features: [],
    plan: "cloud_v0_pro",
    ...extra,
})

describe("plan limit tiles", () => {
    it("lists only Members while the API sends no task or project limits", () => {
        const usage: BillingUsage = {traces_ingested: metric(5, 100), users: metric(2, 2)}

        expect(planLimits(usage)).toEqual([
            {key: "users", label: "Members", value: "2 of 2", note: "At your plan's limit"},
        ])
    })

    it("shows concurrent tasks and projects once the API sends them", () => {
        const usage: BillingUsage = {
            concurrent_tasks: metric(3, 20),
            projects: metric(1, 1),
            users: metric(3, null),
        }

        expect(planLimits(usage)).toEqual([
            {
                key: "concurrent_tasks",
                label: "Concurrent tasks",
                value: "20",
                note: "3 running now",
            },
            {key: "projects", label: "Projects", value: "1 of 1", note: "At your plan's limit"},
            {key: "users", label: "Members", value: "3 · unlimited", note: "No per-seat price"},
        ])
    })

    it("reads a null, absent or negative limit as unlimited", () => {
        const usage = {
            projects: {value: 4, limit: -1},
            concurrent_tasks: {value: 0},
        } as unknown as BillingUsage

        expect(planLimits(usage)).toEqual([
            {
                key: "concurrent_tasks",
                label: "Concurrent tasks",
                value: "Unlimited",
                note: "Tasks running at once",
            },
            {key: "projects", label: "Projects", value: "Unlimited", note: "4 in use"},
        ])
    })

    it("lists nothing without usage", () => {
        expect(planLimits(undefined)).toEqual([])
    })
})

describe("plan catalog extras", () => {
    it("marks a plan recommended only when the catalog says so", () => {
        expect(isRecommended(plan({recommended: true}))).toBe(true)
        expect(isRecommended(plan())).toBe(false)
        expect(isRecommended(plan({recommended: "yes" as unknown as boolean}))).toBe(false)
    })

    it("reads monthly credits only as a positive number", () => {
        expect(monthlyCredits(plan({monthly_credits: 2900}))).toBe(2900)
        expect(monthlyCredits(plan())).toBeNull()
        expect(monthlyCredits(plan({monthly_credits: "2900" as unknown as number}))).toBeNull()
    })

    it("prefers the catalog's own credits line over the monthly grant", () => {
        expect(creditsLine(plan({credits_label: "75 credits a day"}))).toBe("75 credits a day")
        expect(creditsLine(plan({monthly_credits: 32000}))).toBe("32,000 credits a month")
        expect(creditsLine(plan())).toBeNull()
    })

    it("takes the shared list from the first plan that carries one", () => {
        expect(
            sharedFeatures([plan(), plan({shared_features: ["AI Drive", "", "Webhooks"]})]),
        ).toEqual(["AI Drive", "Webhooks"])
        expect(sharedFeatures([plan()])).toEqual([])
    })

    it("turns a leading 'Everything in' line into the card's heading", () => {
        expect(splitLead(["Everything in Hobby", "20 concurrent tasks"])).toEqual({
            lead: "Everything in Hobby, plus:",
            items: ["20 concurrent tasks"],
        })
        expect(splitLead(["2 concurrent tasks"])).toEqual({
            lead: null,
            items: ["2 concurrent tasks"],
        })
    })
})
