// @vitest-environment jsdom
import type {BillingSubscription} from "@agenta/settings-ui"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {PlanSummaryCard} from "@/features/settings/PlanSummaryCard"

afterEach(cleanup)

const DAY = 24 * 60 * 60
const subscription = (offsetDays: number) =>
    ({
        plan: "cloud_v0_pro",
        period_end: Math.floor(Date.now() / 1000) + offsetDays * DAY,
    }) as unknown as BillingSubscription

const card = (offsetDays: number) =>
    render(
        <PlanSummaryCard
            subscription={subscription(offsetDays)}
            monthlyCreditsMusd={null}
            isOnFreePlan={false}
            isCustomPlan={false}
        />,
    )

describe("plan renewal line", () => {
    it("shows the next renewal date", () => {
        card(10)
        expect(screen.queryByText(/^Renews /)).not.toBeNull()
    })

    // A period end in the past is stale data; "Renews <past date>" is false.
    it("hides a renewal date that has already passed", () => {
        card(-25)
        expect(screen.queryByText(/^Renews /)).toBeNull()
    })
})
