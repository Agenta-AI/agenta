// @vitest-environment jsdom
/**
 * An automation tab on the builder page whose automation list fails to load. Whether the id
 * exists is then unknown, so the tab shows the load error with Try again, not "no access". A list
 * that loads without the id still says "no access".
 */
import {act, createElement} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Stable values: the hooks below run every render, and a new array each time would loop.
const lists = vi.hoisted(() => {
    const none: never[] = []
    const refetch = async () => undefined
    const entity = {
        isLoading: false,
        error: null,
        refetch,
        create: async () => null,
        edit: async () => null,
        remove: async () => false,
        setActive: async () => undefined,
    }
    return {
        error: null as Error | null,
        none,
        refetchSchedules: vi.fn(refetch),
        refetch,
        schedule: {...entity, schedule: null},
        subscription: {...entity, subscription: null},
    }
})

vi.mock("@agenta/entities/gatewayTrigger", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTrigger")>()),
    useTriggerSchedules: () => ({
        schedules: lists.none,
        count: 0,
        isLoading: false,
        error: lists.error,
        refetch: lists.refetchSchedules,
    }),
    useTriggerSubscriptions: () => ({
        subscriptions: lists.none,
        count: 0,
        isLoading: false,
        error: null,
        refetch: lists.refetch,
    }),
    useTriggerSchedule: () => lists.schedule,
    useTriggerSubscription: () => lists.subscription,
}))
const stack = vi.hoisted(() => ({depth: 0, open: () => Promise.resolve()}))
vi.mock("@agenta/ui/view-stack", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/view-stack")>()),
    useViewStack: () => stack,
}))
vi.mock("../../src/features/automations/automationView", () => ({automationView: {}}))

const {AutomationTabRoot} = await import("../../src/features/builder-page/AutomationTabRoot")

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    lists.error = null
    lists.refetchSchedules.mockClear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = () =>
    act(async () =>
        root.render(
            createElement(
                Provider,
                {store: createStore()},
                createElement(AutomationTabRoot, {
                    automationId: "auto-1",
                    workspaceId: "ws",
                    projectId: "pr",
                }),
            ),
        ),
    )

describe("AutomationTabRoot", () => {
    it("shows the load error with Retry when the list fails to load", async () => {
        lists.error = new Error("503")
        await render()
        expect(host.textContent).toContain("Could not load automations")
        expect(host.textContent).not.toContain("no longer have access")
        const retry = [...host.querySelectorAll("button")].find((button) =>
            button.textContent?.includes("Try again"),
        )
        expect(retry).toBeTruthy()
        await act(async () => retry?.click())
        expect(lists.refetchSchedules).toHaveBeenCalled()
    })

    it("says no access when the list loads without the automation", async () => {
        await render()
        expect(host.textContent).not.toContain("Could not load automations")
        expect(host.textContent).toContain("no longer have access")
    })
})
