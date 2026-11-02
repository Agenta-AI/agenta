// @vitest-environment jsdom
/**
 * #7936: the first run of a new schedule gave an empty chat. The instruction is stored under the
 * key the agent reads, and only the agent's latest revision says which key that is. Before it
 * loads the field types under "message", which a chat agent never reads.
 *
 * Two rules: a create waits for the revision, and a message stored under "message" is moved to
 * the agent's key once the revision is known, also when the shape was known from the start.
 */
import {act, createElement, type ReactNode} from "react"

import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

type Revision = {
    data?: {schemas?: {inputs?: unknown}}
    flags?: {is_chat?: boolean}
    workflow_variant_id?: string
} | null
interface Latest {
    data: Revision
    isPending: boolean
}

const latest = vi.hoisted(() => ({current: null as unknown as PrimitiveAtom<Latest>}))
const createSchedule = vi.hoisted(() => vi.fn())

// Only the three reads the create hook and the field make; the real module is large.
vi.mock("@agenta/entities/workflow", async () => {
    const {atom: makeAtom} = await import("jotai")
    latest.current = makeAtom<Latest>({data: null, isPending: true})
    const variants = makeAtom({data: []})
    return {
        agentWorkflowsListQueryStateAtom: makeAtom({data: []}),
        workflowVariantsListQueryStateAtomFamily: () => variants,
        workflowLatestRevisionQueryAtomFamily: () => latest.current,
    }
})
// The pure helpers are real; the entity index also loads every trigger query, which is not needed.
vi.mock("@agenta/entities/gatewayTrigger", async () => ({
    ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/cron")),
    ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/eventFields")),
    ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/eventMessageTemplate")),
    ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/eventPreview")),
    ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/latestDeliveryEvent")),
    ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/messageInputs")),
    ...(await import("../../../packages/agenta-entities/src/gatewayTrigger/core/scheduleBuilder")),
    useTriggerSchedule: () => ({schedule: null, create: createSchedule}),
    useTriggerSubscription: () => ({subscription: null, create: vi.fn()}),
    useTriggerDeliveries: () => ({deliveries: []}),
    useTriggerConnectionsQuery: () => ({connections: []}),
    useTriggerEvent: () => ({event: null}),
}))
vi.mock("@agenta/entities/runnable", async () => ({
    ...(await import("../../../packages/agenta-entities/src/runnable/portHelpers")),
}))
vi.mock("@agenta/ui/ui", () => ({Checkbox: () => null}))
vi.mock("@phosphor-icons/react", () => ({Eye: () => null}))
// The composer's editor is not this file's subject.
vi.mock("@agenta/entity-ui/gatewayTrigger", () => ({
    MessageComposer: () => null,
    EventMessageComposer: () => null,
    EventFieldTags: () => null,
    buildTriggerReferences: () => ({}),
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))

// The source files, not the package index: the index pulls in every automation screen.
import {AutomationInstructionField} from "../../../packages/agenta-automation-ui/src/AutomationInstructionField"
import {useAutomationCreate} from "../../../packages/agenta-automation-ui/src/useAutomationCreate"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const chatRevision: Revision = {
    flags: {is_chat: true},
    data: {schemas: {inputs: {type: "object", properties: {messages: {type: "array"}}}}},
    workflow_variant_id: "variant-1",
}

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

const render = (node: ReactNode) =>
    act(async () => root.render(createElement(Provider, {store}, node)))

beforeEach(() => {
    store = createStore()
    store.set(latest.current, {data: null, isPending: true})
    createSchedule.mockReset()
    createSchedule.mockResolvedValue({id: "schedule-1"})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("creating a schedule before the agent's revision loads", () => {
    let seen: ReturnType<typeof useAutomationCreate>
    const Probe = () => {
        seen = useAutomationCreate({defaultAgentId: "agent-1"})
        return null
    }

    it("does not create while the revision is loading, and says so on the instruction", async () => {
        await render(createElement(Probe))
        await act(async () => void (await seen.create()))

        expect(createSchedule).not.toHaveBeenCalled()
        expect(seen.errors.instruction).toBe("Loading the agent. Try again in a moment.")
    })

    it("does not create when the revision read failed", async () => {
        store.set(latest.current, {data: null, isPending: false})
        await render(createElement(Probe))
        await act(async () => void (await seen.create()))

        expect(createSchedule).not.toHaveBeenCalled()
        expect(seen.errors.instruction).toBe(
            "Couldn't load this agent. Reload the page and try again.",
        )
    })

    it("creates once the revision is in hand", async () => {
        store.set(latest.current, {data: chatRevision, isPending: false})
        await render(createElement(Probe))
        await act(async () => void (await seen.create()))

        expect(createSchedule).toHaveBeenCalledTimes(1)
        expect(seen.blockedReason).toBe("")
    })
})

describe("a message stored under the fallback key", () => {
    const field = (inputsFields: unknown, onCommit: (next: Record<string, unknown>) => void) =>
        createElement(AutomationInstructionField, {
            agentId: "agent-1",
            inputsFields,
            onCommit,
            kind: "schedule",
            connectionId: null,
            eventKey: null,
            includeEvent: false,
            onChangeIncludeEvent: () => undefined,
            automation: null,
        })

    it("moves to messages when a saved schedule opens with the chat agent already known", async () => {
        store.set(latest.current, {data: chatRevision, isPending: false})
        const onCommit = vi.fn()
        await render(field({message: "post the digest"}, onCommit))

        expect(onCommit).toHaveBeenCalledWith({
            messages: [{role: "user", content: "post the digest"}],
        })
    })

    it("moves to messages when the revision lands after the message was typed", async () => {
        const onCommit = vi.fn()
        await render(field({message: "post the digest"}, onCommit))
        expect(onCommit).not.toHaveBeenCalled()

        await act(async () => store.set(latest.current, {data: chatRevision, isPending: false}))
        expect(onCommit).toHaveBeenCalledWith({
            messages: [{role: "user", content: "post the digest"}],
        })
    })

    it("is left alone while the revision is unknown", async () => {
        store.set(latest.current, {data: null, isPending: false})
        const onCommit = vi.fn()
        await render(field({message: "post the digest"}, onCommit))

        expect(onCommit).not.toHaveBeenCalled()
    })
})
