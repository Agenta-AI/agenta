// @vitest-environment jsdom
import type {BillingSubscription} from "@agenta/settings-ui"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {PlanSummaryCard} from "@/features/settings/PlanSummaryCard"

afterEach(cleanup)

const DAY = 24 * 60 * 60
const subscription = (offsetDays: number, plan = "cloud_v0_pro") =>
    ({
        plan,
        period_end: Math.floor(Date.now() / 1000) + offsetDays * DAY,
    }) as unknown as BillingSubscription

const card = (offsetDays: number, {plan, selfHosted}: {plan?: string; selfHosted?: boolean} = {}) =>
    render(
        <PlanSummaryCard
            subscription={subscription(offsetDays, plan)}
            monthlyCreditsMusd={null}
            isOnFreePlan={false}
            isCustomPlan={false}
            selfHosted={selfHosted}
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

    // A self-hosted plan comes from the license key; a paid key's expiry is on the License tab.
    it.each(["self_hosted_community", "self_hosted_registered", "self_hosted_enterprise"])(
        "hides the renewal line on the self-hosted plan %s",
        (plan) => {
            card(10, {plan, selfHosted: true})
            expect(screen.queryByText(/^Renews /)).toBeNull()
        },
    )
})
