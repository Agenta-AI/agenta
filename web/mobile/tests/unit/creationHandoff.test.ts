import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    push: vi.fn(),
    fresh: vi.fn(),
    stash: vi.fn(),
    drop: vi.fn(),
    reveal: vi.fn(),
    draft: vi.fn(),
    captureIntent: vi.fn(),
}))
vi.mock("react", () => ({useCallback: (fn: unknown) => fn, useState: () => [false, vi.fn()]}))
vi.mock("next/router", () => ({useRouter: () => ({push: mocks.push})}))
vi.mock("@agenta/chat/state", () => ({
    markSessionFresh: mocks.fresh,
    revealConfigPaneAtom: "reveal",
}))
vi.mock("@agenta/entities/workflow", () => ({
    agentTemplatesAtom: "templates",
    agentTemplateByKey: (templates: {key: string}[], key: string) =>
        templates.find((template) => template.key === key),
    appendSetupPreamble: (text: string) => text,
    invalidateWorkflowsListCache: vi.fn(),
}))
vi.mock("@agenta/home-ui", () => ({useCreateAgent: () => mocks.create}))
vi.mock("@/features/analytics/client", () => ({captureIntent: mocks.captureIntent}))
vi.mock("jotai", () => ({
    useAtomValue: (atom: string) =>
        atom === "templates" ? [{key: "reviewer", name: "Reviewer"}] : undefined,
    useSetAtom: (atom: string) =>
        ({stash: mocks.stash, drop: mocks.drop, reveal: mocks.reveal, draft: mocks.draft})[atom],
}))
vi.mock("../../src/lib/ids", () => ({newId: () => "fresh-session"}))
vi.mock("../../src/features/home/pendingTask", () => ({
    stashPendingTaskAtom: "stash",
    takePendingTaskAtom: "drop",
}))
vi.mock("../../src/features/agents/templateSetupDraft", () => ({templateSetupDraftAtom: "draft"}))

import {useNewAgentAction} from "../../src/features/agents/useNewAgentAction"

beforeEach(() => {
    vi.clearAllMocks()
    mocks.push.mockResolvedValue(true)
    mocks.create.mockResolvedValue({appId: "agent"})
})

describe("creation handoff after merging release changes", () => {
    it("records the template choice before navigation without its prompt", () => {
        useNewAgentAction("/base").createFromTemplate("reviewer")
        expect(mocks.captureIntent).toHaveBeenCalledWith({
            source: "template",
            properties: {template: "Reviewer", templateId: "reviewer", templateCategory: undefined},
            intentValue: "Reviewer",
        })
    })

    it("records a skipped description for blank creation", () => {
        useNewAgentAction("/base").create()
        expect(mocks.captureIntent).toHaveBeenCalledWith({source: "skipped"})
    })

    it("opens an existing server session without dispatching or marking it fresh", async () => {
        mocks.create.mockResolvedValue({appId: "agent", sessionId: "server-session"})
        await useNewAgentAction("/base").createFromPrompt({
            text: "Review this",
            sessionId: "staging",
        })
        expect(mocks.push).toHaveBeenCalledWith("/base/sessions/server-session?agent=agent")
        expect(mocks.fresh).not.toHaveBeenCalled()
        expect(mocks.stash).not.toHaveBeenCalled()
        expect(mocks.reveal).not.toHaveBeenCalled()
    })

    it("opens blank creation with fresh session and configuration visible", async () => {
        await useNewAgentAction("/base").createFromPrompt({text: ""})
        expect(mocks.fresh).toHaveBeenCalledWith("fresh-session")
        expect(mocks.reveal).toHaveBeenCalledOnce()
        expect(mocks.stash).not.toHaveBeenCalled()
        expect(mocks.push).toHaveBeenCalledWith("/base/sessions/fresh-session?agent=agent")
    })

    it("preserves staged ordinary input and dispatches through the pending task", async () => {
        await useNewAgentAction("/base").createFromPrompt({text: "Hello", sessionId: "staging"})
        expect(mocks.fresh).toHaveBeenCalledWith("staging")
        expect(mocks.stash).toHaveBeenCalledWith({
            sessionId: "staging",
            task: {agentId: "agent", text: "Hello", parts: undefined, templateKey: undefined},
        })
        expect(mocks.reveal).not.toHaveBeenCalled()
    })

    it("drops a pending ordinary task when navigation is cancelled", async () => {
        mocks.push.mockResolvedValue(false)
        expect(await useNewAgentAction("/base").createFromPrompt({text: "Hello"})).toBe(false)
        expect(mocks.drop).toHaveBeenCalledWith("fresh-session")
    })
})
