// @vitest-environment jsdom
//
// The automations onboarding offers to start from one of the project's agents, or, with none,
// from an agent template. A failed agent fetch used to read as "no agents" and offered the
// templates; it now says the agents could not be loaded, with a retry.
import {act} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {QueryClient} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {AutomationAgentStarters} from "@/features/automations/AutomationAgentStarters"

import {WithQueryClient} from "../support/queryClient"

interface RosterState {
    data: Workflow[]
    isPending: boolean
    isError: boolean
    error: Error | null
}

const roster = vi.hoisted(() => ({
    state: {data: [], isPending: false, isError: false, error: null} as unknown,
}))

vi.mock("next/router", () => import("../support/nextRouter").then((m) => m.nextRouterModule))

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom} = await import("jotai")
    const original = await importOriginal<typeof import("@agenta/entities/workflow")>()
    return {...original, agentWorkflowsListQueryStateAtom: atom(() => roster.state)}
})

// The template starters fetch a catalog; this file is about the agent roster, so they render a
// marker instead.
vi.mock("@/features/education/FeatureTemplateStarters", () => ({
    FeatureTemplateStarters: () => <div data-testid="template-starters" />,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    host?.remove()
    host = undefined
    vi.restoreAllMocks()
})

const renderWith = (state: Partial<RosterState>) => {
    roster.state = {data: [], isPending: false, isError: false, error: null, ...state}
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
        root!.render(
            <WithQueryClient>
                <Provider store={createStore()}>
                    <AutomationAgentStarters base="/w/workspace/p/project" />
                </Provider>
            </WithQueryClient>,
        )
    })
    return host
}

describe("AutomationAgentStarters", () => {
    it("offers agent templates when the project has no agents", () => {
        const node = renderWith({})
        expect(node.querySelector('[data-testid="template-starters"]')).not.toBeNull()
    })

    it("says the agents could not be loaded instead of offering templates", () => {
        const node = renderWith({isError: true, error: new Error("boom")})
        expect(node.textContent).toContain("Could not load agents")
        expect(node.querySelector('[data-testid="template-starters"]')).toBeNull()
    })

    it("retries by refetching the agent roster", () => {
        // The roster atom has no refetch handle; retry invalidates the key it is cached under.
        const invalidate = vi
            .spyOn(QueryClient.prototype, "invalidateQueries")
            .mockResolvedValue(undefined)
        const node = renderWith({isError: true, error: new Error("boom")})
        const retry = [...node.querySelectorAll("button")].find(
            (button) => button.textContent === "Try again",
        )
        expect(retry, "no retry button").toBeTruthy()

        act(() => {
            retry!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(invalidate).toHaveBeenCalledWith({queryKey: ["workflows"]})
    })
})
