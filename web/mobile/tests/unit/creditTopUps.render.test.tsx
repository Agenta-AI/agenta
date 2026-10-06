// @vitest-environment jsdom
//
// This app's binding of the shared top-up section: what it reads off the page's URL, how it
// clears it, and that each host (Credits tab, Usage & Billing) says where the upgrade goes.
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({
    pathname: "/w/[workspace_id]/p/[project_id]/settings",
    query: {} as Record<string, string>,
    replace: vi.fn(),
    push: vi.fn(),
}))
vi.mock("next/router", () => ({useRouter: () => router}))

const section = vi.hoisted(() => ({props: null as Record<string, unknown> | null}))
vi.mock("@agenta/settings-ui", async () => {
    const rules = await import("../../../packages/agenta-settings-ui/src/billing/topups/topUpRules")
    return {
        ...rules,
        CreditTopUpsSection: (props: Record<string, unknown>) => {
            section.props = props
            return null
        },
    }
})

import {CreditTopUps} from "@/features/wallet/CreditTopUps"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    section.props = null
    router.replace.mockClear()
})

const render = (element: React.ReactElement) => {
    root = createRoot(document.createElement("div"))
    act(() => root!.render(element))
    return section.props!
}

describe("CreditTopUps", () => {
    it("reads Stripe's return and the picker request off the URL", () => {
        router.query = {
            workspace_id: "ws",
            project_id: "pr",
            tab: "billing",
            topup: "success",
            topup_session: "cs_test_1",
            buy_credits: "1",
        }
        const props = render(<CreditTopUps projectId="pr" onUpgrade={() => undefined} framed />)

        expect(props.topUpReturn).toEqual({result: "success", sessionId: "cs_test_1"})
        expect(props.openPicker).toBe(true)
        expect(props.framed).toBe(true)
    })

    it("clears only its own keys, keeping the route's params out of the query string", () => {
        router.query = {workspace_id: "ws", project_id: "pr", tab: "credits", topup: "cancelled"}
        const props = render(<CreditTopUps projectId="pr" onUpgrade={() => undefined} />)

        act(() => (props.onQueryHandled as () => void)())

        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: "/w/[workspace_id]/p/[project_id]/settings",
                query: {workspace_id: "ws", project_id: "pr", tab: "credits"},
            },
            undefined,
            {shallow: true},
        )
    })

    it("sends the free plan's upgrade where the host says", () => {
        router.query = {tab: "billing"}
        const onUpgrade = vi.fn()
        const props = render(<CreditTopUps projectId="pr" onUpgrade={onUpgrade} framed />)

        ;(props.onUpgrade as () => void)()

        expect(onUpgrade).toHaveBeenCalled()
        expect(props.topUpReturn).toBeNull()
        expect(props.openPicker).toBe(false)
    })
})
