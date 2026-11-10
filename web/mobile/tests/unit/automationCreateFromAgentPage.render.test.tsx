// @vitest-environment jsdom
/**
 * Creating an automation from the agent page. The agent page opens the create drawer with the
 * agent's REVISION id, and the create waits for the agent's latest revision (#7980). That read
 * is keyed by the agent's own id, so the drawer has to hand the hook the agent id from the
 * references, the same id the automations screen passes. With the revision id the read found
 * nothing and every create stopped on "Couldn't load this agent".
 */
import {act, createElement, type ReactNode} from "react"

import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

interface Latest {
    data: {
        data?: {schemas?: {inputs?: unknown}}
        flags?: {is_chat?: boolean}
        workflow_variant_id?: string
    } | null
    isPending: boolean
}

const mocks = vi.hoisted(() => ({
    scheduleDrawer: null as unknown as PrimitiveAtom<unknown>,
    subscriptionDrawer: null as unknown as PrimitiveAtom<unknown>,
    latestKeys: [] as string[],
    createSchedule: vi.fn(),
    chatRevision: {
        flags: {is_chat: true},
        data: {schemas: {inputs: {type: "object", properties: {messages: {type: "array"}}}}},
        workflow_variant_id: "variant-1",
    } as Latest["data"],
}))

// The latest-revision read answers only for the agent's own id, as the API does: a revision id
// in its place matches no agent.
vi.mock("@agenta/entities/workflow", async () => {
    const {atom: makeAtom} = await import("jotai")
    const found = makeAtom<Latest>({data: mocks.chatRevision, isPending: false})
    const none = makeAtom<Latest>({data: null, isPending: false})
    const variants = makeAtom({data: []})
    const artifactName = makeAtom<string | null>(null)
    return {
        agentWorkflowsListQueryStateAtom: makeAtom({data: []}),
        workflowVariantsListQueryStateAtomFamily: () => variants,
        workflowLatestRevisionQueryAtomFamily: (id: string) => {
            mocks.latestKeys.push(id)
            return id === "agent-1" ? found : none
        },
        workflowMolecule: {selectors: {artifactName: () => artifactName}},
    }
})
vi.mock("@agenta/entities/gatewayTrigger", async () => {
    const {atom: makeAtom} = await import("jotai")
    mocks.scheduleDrawer = makeAtom<unknown>(null)
    mocks.subscriptionDrawer = makeAtom<unknown>(null)
    return {
        // The pure helpers are real; the entity index also loads every trigger query.
        ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/cron")),
        ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/messageInputs")),
        ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/scheduleBuilder")),
        triggerScheduleDrawerAtom: mocks.scheduleDrawer,
        triggerSubscriptionDrawerAtom: mocks.subscriptionDrawer,
        useTriggerSchedule: () => ({schedule: null, create: mocks.createSchedule}),
        useTriggerSubscription: () => ({subscription: null, create: vi.fn()}),
    }
})
vi.mock("@agenta/entity-ui/gatewayTrigger", () => ({buildTriggerReferences: () => ({})}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
vi.mock("@agenta/ui/drawer", () => ({
    EnhancedDrawer: ({children, footer}: {children: ReactNode; footer?: ReactNode}) =>
        createElement("div", null, children, footer),
}))
vi.mock("@agenta/ui/ui", () => {
    const button = ({children, onClick}: {children: ReactNode; onClick?: () => void}) =>
        createElement("button", {type: "button", onClick}, children)
    return {Button: button, LoadingButton: button}
})
// The form and the edit side are not this file's subject.
vi.mock("../../../packages/agenta-automation-ui/src/AutomationCreateBody", () => ({
    AutomationCreateBody: () => null,
}))
vi.mock("../../../packages/agenta-automation-ui/src/AutomationDetailBody", () => ({
    AutomationDetailBody: () => null,
}))
vi.mock("../../../packages/agenta-automation-ui/src/AutomationSaveBar", () => ({
    AutomationSaveBar: () => null,
}))
vi.mock("../../../packages/agenta-automation-ui/src/AutomationTriggerDrawers", () => ({
    AutomationTriggerDrawers: () => null,
}))
vi.mock("../../../packages/agenta-automation-ui/src/states/AutomationStates", () => ({
    AutomationDetailSkeleton: () => null,
}))
vi.mock("../../../packages/agenta-automation-ui/src/useAutomationEditor", () => ({
    useAutomationEditor: () => ({}),
}))

import {AutomationDrawer} from "../../../packages/agenta-automation-ui/src/AutomationDrawer"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

beforeEach(() => {
    store = createStore()
    mocks.latestKeys.length = 0
    mocks.createSchedule.mockReset()
    mocks.createSchedule.mockResolvedValue({id: "schedule-1"})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const pressCreate = async () => {
    const button = [...host.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === "Create automation",
    )
    expect(button).toBeDefined()
    await act(async () => button?.click())
}

describe("the create drawer opened from the agent page", () => {
    it("reads the agent's latest revision by the agent id, not the revision id, and creates", async () => {
        // What the agent page's "+" sets: the revision id plus the references it resolved.
        store.set(mocks.scheduleDrawer, {
            playgroundEntityId: "revision-1",
            defaultBoundLabel: "Support agent",
            defaultReferences: {
                application: {id: "agent-1", slug: "support-agent"},
                application_variant: {id: "variant-1"},
            },
        })
        await act(async () =>
            root.render(createElement(Provider, {store}, createElement(AutomationDrawer))),
        )

        expect(mocks.latestKeys).toContain("agent-1")
        expect(mocks.latestKeys).not.toContain("revision-1")

        await pressCreate()

        expect(mocks.createSchedule).toHaveBeenCalledTimes(1)
        expect(mocks.createSchedule.mock.calls[0][0].data.references).toEqual({
            application: {id: "agent-1", slug: "support-agent"},
            application_variant: {id: "variant-1"},
        })
    })
})
