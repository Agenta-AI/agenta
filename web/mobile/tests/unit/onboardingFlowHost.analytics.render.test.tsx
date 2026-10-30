// @vitest-environment jsdom
import {act, type ComponentProps} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    capture: vi.fn(),
    captureIntent: vi.fn(),
    pending: true,
    flow: null as Record<string, (...args: never[]) => unknown> | null,
    templates: [
        {key: "lead-qualifier", name: "Lead qualifier", category: "Sales"},
    ] as readonly unknown[],
}))

vi.mock("@/features/analytics/client", () => ({
    capture: state.capture,
    captureIntent: state.captureIntent,
}))
vi.mock("@/features/onboarding/OnboardingFlow", () => ({
    OnboardingFlow: (props: Record<string, (...args: never[]) => unknown>) => {
        state.flow = props
        return null
    },
}))
vi.mock("@/features/onboarding/onboardingPending", () => ({
    endOnboarding: vi.fn(),
    isOnboardingPending: () => state.pending,
}))
vi.mock("@/features/onboarding/useOnboardingModel", () => ({
    useOnboardingModel: () => ({}),
}))
vi.mock("@/features/onboarding/useSeedToolConnections", () => ({
    useSeedToolConnections: vi.fn(),
}))
vi.mock("@/features/onboarding/onboardingDraft", () => ({onboardingDraftKey: () => "draft"}))
vi.mock("@/features/onboarding/onboardingApps", () => ({connectedApps: () => new Set()}))
vi.mock("@/features/onboarding/onboardingConfig", async () => {
    const {atom} = await import("jotai")
    return {draftConfigurationAtom: () => atom(null), onboardingConfiguration: () => ({})}
})
vi.mock("@/features/agents/useNewAgentAction", () => ({
    useNewAgentAction: () => ({
        creating: false,
        error: null,
        createFromPrompt: () => Promise.resolve(true),
    }),
}))
vi.mock("@agenta/chat/hooks", () => ({
    stagedFilesToParts: vi.fn(),
    useComposerAttachments: () => ({
        files: [],
        clearAttachments: vi.fn(),
        restoreAttachments: vi.fn(),
    }),
}))
vi.mock("@agenta/entities/gatewayTool", () => ({
    useToolConnectionsQuery: () => ({connections: [], isLoading: false, error: null}),
}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    return {
        agentIconAtomFamily: () => atom(null),
        agentTemplateByKey: (templates: readonly {key: string}[], key: string) =>
            templates.find((template) => template.key === key),
        agentTemplatesAtom: atom(state.templates),
        agentTemplatesStatusAtom: atom("ready"),
        refetchAgentTemplatesAtom: atom(null, () => undefined),
        workflowMolecule: {actions: {updateConfiguration: atom(null, () => undefined)}},
    }
})
vi.mock("@agenta/shared/api/env", () => ({
    isToolsEnabled: () => false,
    isWalletsEnabled: () => false,
}))
vi.mock("@agenta/shared/analytics", () => ({
    classifyAgentIntent: () => "research",
}))
vi.mock("@agenta/ui/agent-icon", () => ({
    loadAgentIconCatalog: () => Promise.resolve([]),
}))
vi.mock("next/router", () => ({useRouter: () => ({replace: vi.fn()})}))
vi.mock("@/lib/ids", () => ({newId: () => "session-1"}))

const {OnboardingFlowHost} = await import("@/features/onboarding/OnboardingFlowHost")

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const draft = {
    answers: {persona: "Marketing", size: "51-200", source: "GitHub"},
    category: "recommended",
    agent: {name: "", icon: {icon: "a", color: "b"}, firstMessage: ""},
    completed: [],
}

let root: Root | undefined

const mount = () => {
    root = createRoot(document.createElement("div"))
    const props: ComponentProps<typeof OnboardingFlowHost> = {
        base: "/w/w/p/p",
        projectId: "p",
        entityId: "entity-1",
        userId: "user-1",
        userEmail: "person@example.com",
        homeUrl: "/home",
    }
    act(() => root!.render(<OnboardingFlowHost {...props} />))
}

const flow = () =>
    state.flow as unknown as ComponentProps<
        typeof import("@/features/onboarding/OnboardingFlow").OnboardingFlow
    >

const surveyEvents = () => state.capture.mock.calls.filter(([event]) => event === "survey sent")

beforeEach(() => {
    state.pending = true
    state.capture.mockClear()
    state.captureIntent.mockClear()
})

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
})

describe("the onboarding's PostHog events", () => {
    it("sends the signup survey on the last question, and on no other step", () => {
        mount()
        for (const step of ["persona", "size"] as const) flow().onStepCompleted(step, draft)
        expect(surveyEvents()).toEqual([])

        flow().onStepCompleted("source", draft)
        expect(surveyEvents()).toHaveLength(1)
        expect(surveyEvents()[0][1]).toMatchObject({
            $survey_id: "019f3812-8ce3-0000-1123-8c254a48750d",
            "$survey_response_d6c2d8aa-d624-4736-a71b-25fe0b74d0e9": "person@example.com",
        })

        flow().onStepCompleted("credits", draft)
        expect(surveyEvents()).toHaveLength(1)
    })

    it("sends nothing from a preview", () => {
        state.pending = false
        mount()
        flow().onStepCompleted("source", draft)
        flow().onSkip()
        expect(state.capture).not.toHaveBeenCalledWith("survey sent", expect.anything())
        expect(state.captureIntent).not.toHaveBeenCalled()
    })

    it("reports a template pick as the first agent's intent", async () => {
        mount()
        await act(() =>
            flow().onCreate({
                name: "Lead qualifier",
                firstMessage: "",
                templateKey: "lead-qualifier",
                icon: {icon: "a", color: "b"},
                apps: [],
            }),
        )
        expect(state.captureIntent).toHaveBeenCalledWith(
            expect.objectContaining({source: "template", intentValue: "Sales"}),
        )
    })

    it("reports a typed first message by its keyword group, never its text", async () => {
        mount()
        await act(() =>
            flow().onCreate({
                name: "",
                firstMessage: "summarize my inbox",
                templateKey: null,
                icon: {icon: "a", color: "b"},
                apps: [],
            }),
        )
        expect(state.captureIntent).toHaveBeenCalledWith({
            source: "composer",
            intentValue: "research",
        })
    })

    it("reports Skip for now as skipped", () => {
        mount()
        flow().onSkip()
        expect(state.captureIntent).toHaveBeenCalledWith({source: "skipped"})
    })
})
