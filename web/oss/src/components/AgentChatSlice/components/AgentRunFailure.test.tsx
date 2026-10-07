/**
 * The desktop's billing escapes on a failed run: the plans for any plan limit, and "Buy credits"
 * only for running out of credits where the organization can buy a pack.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {afterEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({billing: true, status: "available"}))

vi.mock("next/router", () => ({
    useRouter: () => ({push: vi.fn(), query: {workspace_id: "ws-1", project_id: "proj-1"}}),
}))
vi.mock("@/oss/hooks/useURL", () => ({default: () => ({projectURL: "/w/ws-1/p/proj-1"})}))
vi.mock("@agenta/shared/api", () => ({isBillingEnabled: () => state.billing}))
vi.mock("@agenta/settings-ui", () => ({
    useTopUpOffer: ({enabled}: {enabled?: boolean}) => ({
        data: enabled ? {status: state.status, packs: []} : undefined,
    }),
}))

import AgentRunFailure from "./AgentRunFailure"

const render = (code: string) =>
    renderToStaticMarkup(
        <AgentRunFailure
            text="You've used all your organization's credits."
            stateKey="t"
            code={code}
        />,
    )

afterEach(() => {
    state.billing = true
    state.status = "available"
})

describe("AgentRunFailure", () => {
    it("offers Buy credits and the plans when out of credits on a paid plan", () => {
        const html = render("wallet_balance_exhausted")
        expect(html).toContain("Buy credits")
        expect(html).toContain("Plans and billing")
    })

    it("keeps only the plans on the free plan", () => {
        state.status = "paid_plan_required"
        const html = render("wallet_balance_exhausted")
        expect(html).not.toContain("Buy credits")
        expect(html).toContain("Plans and billing")
    })

    it("offers only the plans for a limit credits do not clear", () => {
        const html = render("concurrent_turns_limit")
        expect(html).not.toContain("Buy credits")
        expect(html).toContain("Plans and billing")
    })

    it("changes nothing where the wallet is off or in shadow (the API answers unavailable)", () => {
        state.status = "unavailable"
        for (const code of ["wallet_balance_exhausted", "concurrent_turns_limit"]) {
            const html = render(code)
            expect(html).not.toContain("Buy credits")
            expect(html).not.toContain("Plans and billing")
        }
    })

    it("offers neither where billing is off", () => {
        state.billing = false
        const html = render("wallet_balance_exhausted")
        expect(html).not.toContain("Buy credits")
        expect(html).not.toContain("Plans and billing")
    })
})
