// @vitest-environment jsdom
/**
 * The chat's "Connect your accounts" card marks a row done only when a Needs setup answer leaves
 * it out. While the answer is loading or failed (`null`), the last answer stands, so a failed
 * refresh never reads as "set up".
 */
import {act, createElement} from "react"

import type {AgentRequirementItem} from "@agenta/entities/workflow"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {requirementsAtom} = vi.hoisted(() => ({
    requirementsAtom: {current: null as unknown as PrimitiveAtom<AgentRequirementItem[] | null>},
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom: mockAtom} = await import("jotai")
    requirementsAtom.current = mockAtom<AgentRequirementItem[] | null>(null)
    const workflowIdAtom = mockAtom("agent-1")
    return {
        agentRequirementsAtomFamily: () => requirementsAtom.current,
        workflowMolecule: {selectors: {workflowId: () => workflowIdAtom}},
    }
})

vi.mock("@agenta/entity-ui/onboarding", () => ({
    personalSetupItems: (requirements: AgentRequirementItem[]) =>
        requirements.map((req) => ({key: req.key, kind: "secret", name: req.label})),
}))

import {usePersonalSetupStep, type PersonalSetupStep} from "@/features/chat/usePersonalSetupStep"

const req = (key: string): AgentRequirementItem =>
    ({key, kind: "secret", label: key, account_source: "user"}) as AgentRequirementItem

let root: Root
let container: HTMLDivElement
let step: PersonalSetupStep
let store: ReturnType<typeof createStore>

const Probe = () => {
    step = usePersonalSetupStep("session-1", "revision-1")
    return null
}

beforeEach(() => {
    store = createStore()
    container = document.createElement("div")
    root = createRoot(container)
    act(() => root.render(createElement(Provider, {store}, createElement(Probe))))
})

afterEach(() => act(() => root.unmount()))

const answer = (value: AgentRequirementItem[] | null) =>
    act(() => store.set(requirementsAtom.current, value))

describe("usePersonalSetupStep", () => {
    it("keeps the rows pending while the next answer is loading or failed", () => {
        answer([req("secret:user/A"), req("secret:user/B")])
        expect(step.open).toBe(true)
        expect([...step.pendingKeys]).toEqual(["secret:user/A", "secret:user/B"])

        answer(null)
        expect([...step.pendingKeys]).toEqual(["secret:user/A", "secret:user/B"])
        expect(step.items).toHaveLength(2)
    })

    it("marks a row done only when an answer leaves it out", () => {
        answer([req("secret:user/A"), req("secret:user/B")])
        answer([req("secret:user/B")])
        expect([...step.pendingKeys]).toEqual(["secret:user/B"])
        expect(step.items.map((item) => item.key)).toEqual(["secret:user/A", "secret:user/B"])
    })
})
