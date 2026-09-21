// @vitest-environment jsdom
import {act, createElement} from "react"

import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {push, createAgent, template} = vi.hoisted(() => ({
    push: vi.fn(),
    createAgent: vi.fn(),
    template: {key: "pr-reviewer", name: "PR reviewer"},
}))
vi.mock("next/router", () => ({useRouter: () => ({push})}))
vi.mock("@agenta/chat/state", () => ({markSessionFresh: vi.fn()}))
vi.mock("@agenta/home-ui", () => ({useCreateAgent: () => createAgent}))
vi.mock("@agenta/entities/workflow", () => ({
    agentTemplateByKey: () => template,
    appendSetupPreamble: (text: string) => text,
    invalidateWorkflowsListCache: vi.fn(),
}))

import {templateSetupDraftAtom} from "@/features/agents/templateSetupDraft"
import {useNewAgentAction} from "@/features/agents/useNewAgentAction"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true
let root: Root
let actions: ReturnType<typeof useNewAgentAction>
const base = "/w/workspace/p/project"

beforeEach(async () => {
    push.mockReset().mockResolvedValue(true)
    createAgent.mockReset().mockResolvedValue({appId: "agent", sessionId: "session"})
    getDefaultStore().set(templateSetupDraftAtom, null)
    root = createRoot(document.createElement("div"))
    const Probe = () => {
        actions = useNewAgentAction(base)
        return null
    }
    await act(async () => root.render(createElement(Probe)))
})
afterEach(() => act(() => root.unmount()))

describe("template setup before the first run", () => {
    it("opens the existing setup route instead of starting a template from the roster", async () => {
        await act(async () => actions.createFromTemplate("pr-reviewer"))
        expect(createAgent).not.toHaveBeenCalled()
        expect(push).toHaveBeenCalledWith(`${base}/agents/new?template=pr-reviewer`)
    })
    it("preserves an edited Home prompt and its staging scope", async () => {
        await act(async () => {
            await actions.createFromPrompt({
                text: "Ask before posting",
                templateKey: "pr-reviewer",
                sessionId: "staged",
            })
        })
        expect(createAgent).not.toHaveBeenCalled()
        expect(getDefaultStore().get(templateSetupDraftAtom)).toMatchObject({
            base,
            templateKey: "pr-reviewer",
            text: "Ask before posting",
            sessionId: "staged",
        })
    })
    it("loads the template with the confirmed provider choice", async () => {
        const setup = {connectedSlugs: ["gitlab"], accounts: []}
        await act(async () => {
            await actions.createFromPrompt({
                text: "Review",
                templateKey: "pr-reviewer",
                entityId: "local-draft",
                setup,
            })
        })
        expect(createAgent).toHaveBeenCalledWith(
            expect.objectContaining({template, entityId: "local-draft", setup}),
        )
        expect(push).toHaveBeenCalledWith(`${base}/sessions/session?agent=agent`)
    })
    it("keeps ordinary free-text creation on its original path", async () => {
        await act(async () => {
            await actions.createFromPrompt({text: "Help me write"})
        })
        expect(createAgent).toHaveBeenCalledOnce()
        expect(getDefaultStore().get(templateSetupDraftAtom)).toBeNull()
    })
    it("drops the draft if setup navigation is cancelled", async () => {
        push.mockResolvedValue(false)
        await act(async () => actions.createFromTemplate("pr-reviewer"))
        expect(createAgent).not.toHaveBeenCalled()
        expect(getDefaultStore().get(templateSetupDraftAtom)).toBeNull()
    })
})
