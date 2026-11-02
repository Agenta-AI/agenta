import {beforeEach, describe, expect, it, vi} from "vitest"

const post = vi.fn()

vi.mock("@agenta/shared/api", () => ({
    axios: {post: (...args: unknown[]) => post(...args)},
    getAgentaApiUrl: () => "https://api.test",
}))

import {checkoutBillingSubscription, openBillingPortal} from "../../src/billing/api"

describe("billing Stripe calls", () => {
    beforeEach(() => {
        post.mockReset()
    })

    it("opens the portal for the given project", async () => {
        post.mockResolvedValue({data: {portal_url: "https://portal.test"}})

        const url = await openBillingPortal("project-team")

        expect(url).toBe("https://portal.test")
        expect(post).toHaveBeenCalledWith("https://api.test/billing/stripe/portals/", null, {
            params: {project_id: "project-team"},
        })
    })

    it("starts checkout for the given project", async () => {
        post.mockResolvedValue({data: {checkout_url: "https://checkout.test"}})

        const url = await checkoutBillingSubscription({
            plan: "cloud_v0_pro",
            successUrl: "https://app.test/m/settings?tab=billing",
            projectId: "project-team",
        })

        expect(url).toBe("https://checkout.test")
        expect(post).toHaveBeenCalledWith("https://api.test/billing/stripe/checkouts/", null, {
            params: {
                plan: "cloud_v0_pro",
                success_url: "https://app.test/m/settings?tab=billing",
                project_id: "project-team",
            },
        })
    })
})
