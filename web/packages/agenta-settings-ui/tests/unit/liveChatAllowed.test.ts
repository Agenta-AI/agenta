import {describe, expect, it} from "vitest"

import {liveChatAllowed} from "../../src/billing/liveChatAllowed"

describe("liveChatAllowed", () => {
    it("hides live chat on the free plan", () => {
        expect(liveChatAllowed({deploymentEnabled: true, billingEnabled: true, plan: "free"})).toBe(
            false,
        )
    })

    it("shows live chat on a paid plan", () => {
        expect(liveChatAllowed({deploymentEnabled: true, billingEnabled: true, plan: "paid"})).toBe(
            true,
        )
    })

    it("keeps live chat hidden while the plan loads, so Crisp does not load early", () => {
        expect(
            liveChatAllowed({deploymentEnabled: true, billingEnabled: true, plan: "loading"}),
        ).toBe(false)
    })

    it("shows live chat when the plan cannot be read", () => {
        expect(
            liveChatAllowed({deploymentEnabled: true, billingEnabled: true, plan: "unreadable"}),
        ).toBe(true)
    })

    it("leaves the decision to the deployment when billing is off", () => {
        expect(
            liveChatAllowed({deploymentEnabled: true, billingEnabled: false, plan: "loading"}),
        ).toBe(true)
        expect(
            liveChatAllowed({deploymentEnabled: false, billingEnabled: true, plan: "paid"}),
        ).toBe(false)
    })
})
