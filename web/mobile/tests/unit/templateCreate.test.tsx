// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {push, createAgent, template} = vi.hoisted(() => ({
    push: vi.fn(),
    createAgent: vi.fn(),
    template: {key: "pr-reviewer", name: "PR reviewer"},
}))
vi.mock("next/router", () => ({useRouter: () => ({push})}))
vi.mock("@agenta/chat/state", async () => {
    const {atom} = await import("jotai")
    return {markSessionFresh: vi.fn(), revealConfigPaneAtom: atom(null, () => undefined)}
})
vi.mock("@agenta/home-ui", () => ({useCreateAgent: () => createAgent}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        // The loaded catalogue; lookups resolve against the list the hook read from it.
        agentTemplatesAtom: atom([template]),
        agentTemplateByKey: (templates: {key: string}[], key: string) =>
            templates.find((item) => item.key === key),
        invalidateWorkflowsListCache: vi.fn(),
    }
})

import {useNewAgentAction} from "@/features/agents/useNewAgentAction"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true
let root: Root
let actions: ReturnType<typeof useNewAgentAction>
const base = "/w/workspace/p/project"

beforeEach(async () => {
    push.mockReset().mockResolvedValue(true)
    createAgent.mockReset().mockResolvedValue({appId: "agent", sessionId: "session"})
    root = createRoot(document.createElement("div"))
    const Probe = () => {
        actions = useNewAgentAction(base)
        return null
    }
    await act(async () => root.render(createElement(Probe)))
})
afterEach(() => act(() => root.unmount()))

describe("template create", () => {
    it("creates the agent and opens its first session with no setup screen", async () => {
        await act(async () => actions.createFromTemplate("pr-reviewer"))
        expect(createAgent).toHaveBeenCalledWith(
            expect.objectContaining({template, name: "PR reviewer"}),
        )
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(`${base}/sessions/session?agent=agent`)
    })
    it("loads the template with an edited Home prompt and its staging scope", async () => {
        await act(async () => {
            await actions.createFromPrompt({
                text: "Ask before posting",
                templateKey: "pr-reviewer",
                sessionId: "staged",
            })
        })
        expect(createAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                template,
                initialMessage: "Ask before posting",
                stagingSessionId: "staged",
            }),
        )
        expect(push).toHaveBeenCalledWith(`${base}/sessions/session?agent=agent`)
    })
    it("never creates a blank agent for a template key the catalogue cannot resolve", async () => {
        let handedOff = true
        await act(async () => {
            handedOff = await actions.createFromPrompt({
                text: "Review",
                templateKey: "not-in-catalogue",
                entityId: "local-draft",
            })
        })
        expect(handedOff).toBe(false)
        expect(createAgent).not.toHaveBeenCalled()
        expect(actions.error).toBeTruthy()
    })
    it("keeps ordinary free-text creation on its original path", async () => {
        await act(async () => {
            await actions.createFromPrompt({text: "Help me write"})
        })
        expect(createAgent).toHaveBeenCalledOnce()
        expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({template: undefined}))
    })
})
