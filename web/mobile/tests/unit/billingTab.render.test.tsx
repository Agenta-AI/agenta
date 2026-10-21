// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({canEditBilling: true, billingEnabled: true}))

vi.mock("../../src/features/context/useProjectPermission", () => ({
    useProjectPermission: (_projectId: string, action: string) =>
        action === "edit_billing" && fixture.canEditBilling,
}))

vi.mock("next/router", () => ({
    useRouter: () => ({query: {}, pathname: "/settings", replace: vi.fn()}),
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    isBillingEnabled: () => fixture.billingEnabled,
}))

vi.mock("@tanstack/react-query", async (original) => ({
    ...(await original<object>()),
    useQuery: () => ({isPending: false, isError: false, data: {}}),
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

vi.mock("@agenta/settings-ui", async (original) => ({
    ...(await original<object>()),
    fetchBillingUsage: vi.fn(),
    useBillingSubscription: () => ({
        isPending: false,
        isError: false,
        data: {plan: "cloud_v0_pro", period_end: null},
    }),
    useBillingCatalog: () => ({
        plans: [],
        isLoading: false,
        isOnFreePlan: false,
        isCustomPlan: false,
        freePlanSlug: null,
    }),
}))

vi.mock("../../src/features/wallet/useWalletSummary", () => ({
    useWalletSummary: () => ({data: null}),
}))

// The sheets fetch on their own; only the buttons that open them are under test.
vi.mock("../../src/features/settings/PlanChooserSheet", () => ({PlanChooserSheet: () => null}))
vi.mock("../../src/features/settings/CancelSubscriptionSheet", () => ({
    CancelSubscriptionSheet: () => null,
}))

import {BillingTab} from "@/features/settings/BillingTab"

const WRITE_ACTIONS = ["Change plan", "Cancel subscription", "View in billing portal"]

const buttons = () =>
    Array.from(document.querySelectorAll("button")).map((button) => button.textContent?.trim())

describe("BillingTab", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
        fixture.canEditBilling = true
        fixture.billingEnabled = true
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const mount = () =>
        act(() => {
            root.render(<BillingTab workspaceId="ws-1" projectId="proj-1" />)
        })

    it("offers the plan, cancel and portal actions to a member with edit_billing", () => {
        mount()

        for (const label of WRITE_ACTIONS) expect(buttons()).toContain(label)
    })

    it("hides them from a member without edit_billing, such as an editor", () => {
        fixture.canEditBilling = false
        mount()

        for (const label of WRITE_ACTIONS) expect(buttons()).not.toContain(label)
        // The plan is still named: viewing billing is allowed.
        expect(document.body.textContent).toContain("Current plan")
    })

    it("hides them when billing is off, whatever the permission", () => {
        fixture.billingEnabled = false
        mount()

        for (const label of WRITE_ACTIONS) expect(buttons()).not.toContain(label)
    })
})
