import {act, createElement, type ReactNode} from "react"

import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {onCreateMock, routerState, composer, templates, passthrough, nothing} = vi.hoisted(() => ({
    passthrough: ({children}: {children?: ReactNode}) => children ?? null,
    nothing: () => null,
    onCreateMock: vi.fn(),
    routerState: {query: {} as Record<string, string | undefined>},
    composer: {
        text: "",
        onCreate: null as null | ((markdown?: string) => Promise<void>),
    },
    templates: [] as unknown[],
}))

// Only what StripHome's first-run surface uses.
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    interface Template {
        key: string
        builderMessage: string
        connections: {primary: {slug: string}; required: boolean}[]
    }
    return {
        appTemplatesQueryAtom: atom(null),
        agentTemplatesAtom: atom(() => templates),
        agentTemplatesStatusAtom: atom("success"),
        agentTemplateByKey: (list: Template[], key?: string) =>
            key ? list.find((entry) => entry.key === key) : undefined,
        templateBuilderMessage: (template: Template) => template.builderMessage,
        UNAVAILABLE_TEMPLATE_MESSAGE: "unavailable",
        detectAccounts: ({template}: {template?: Template}) =>
            (template?.connections ?? []).map((c) => ({
                slug: c.primary.slug,
                required: c.required,
            })),
    }
})
vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    useToolConnectionsQuery: () => ({
        connections: [{integration_key: "github"}, {integration_key: "notion"}],
    }),
}))
// The real step, reduced: PR reviewer still has a GitHub choice to offer, while Content
// repurposer's Notion is already connected, so its step does not open.
vi.mock("@agenta/entity-ui/onboarding", async () => {
    const {useCallback, useState} = await import("react")
    return {
        AgentSetupCard: nothing,
        useAgentSetupStep: () => {
            const [draft, setDraft] = useState<{template?: AgentStarterTemplate} | null>(null)
            const open = useCallback((next: {template?: AgentStarterTemplate}) => {
                if (!next.template?.connections.some((c) => c.primary.slug === "github")) {
                    return false
                }
                setDraft(next)
                return true
            }, [])
            const close = useCallback(() => setDraft(null), [])
            return {draft, accounts: [], suggestions: [], open, close, addAccount: vi.fn()}
        },
    }
})
vi.mock("@agenta/home-ui", () => ({HomeOverview: nothing, UsageCard: nothing}))
vi.mock("@agenta/ui", () => ({PageLayout: passthrough}))
vi.mock("@agenta/ui/components/page-width", () => ({pageContentWidthClass: ""}))
vi.mock("@agenta/ui/height-collapse", () => ({HeightCollapse: passthrough}))
vi.mock("@phosphor-icons/react", () => ({ArrowLeftIcon: nothing}))
vi.mock("antd", () => {
    const app = {message: {warning: vi.fn()}}
    return {App: {useApp: () => app}, Typography: {Title: passthrough, Text: passthrough}}
})
vi.mock("next/dynamic", () => ({default: () => nothing}))
vi.mock("next/link", () => ({default: passthrough}))
vi.mock("next/router", () => ({useRouter: () => routerState}))
vi.mock("@/oss/components/AgentChatSlice/hooks/useOpenAgentSession", () => ({
    useOpenAgentSession: () => vi.fn(),
}))
vi.mock("@/oss/components/AgentChatSlice/hooks/useSessionActions", () => ({
    useSessionActions: () => ({}),
}))
vi.mock("@/oss/components/NewAgentButton", () => ({default: nothing}))
vi.mock("@/oss/components/NextTriggers", () => ({default: nothing}))
vi.mock("@/oss/components/pages/agents/store", async () => {
    const {atom} = await import("jotai")
    return {agentsWorkflowsAtom: atom([]), agentsWorkflowsLoadingAtom: atom(false)}
})
vi.mock("@/oss/components/pages/sessions/components/SessionAutomationDrawers", () => ({
    default: nothing,
}))
vi.mock("@/oss/components/TemplateStrip", () => ({default: nothing}))
vi.mock("@/oss/components/TemplateStrip/components/TemplateChipDock", () => ({default: nothing}))
// A plain-text stand-in for the editor, with its Create handler exposed to the test.
vi.mock("@/oss/components/TemplateStrip/components/StripComposer", () => ({
    default: ({
        composerRef,
        onCreate,
    }: {
        composerRef: {current: unknown}
        onCreate: (markdown?: string) => Promise<void>
    }) => {
        composerRef.current = {
            setMarkdown: (text: string) => {
                composer.text = text
            },
            getMarkdown: () => composer.text,
        }
        composer.onCreate = onCreate
        return null
    },
}))
vi.mock("@/oss/hooks/useURL", () => ({default: () => ({baseAppURL: "/apps", projectURL: "/p"})}))
vi.mock("@/oss/state/layout/fullHeight", async () => {
    const {atom} = await import("jotai")
    return {layoutFullHeightRequestAtom: atom(null, () => undefined)}
})
vi.mock("./assets/constants", () => ({
    HERO: {title: "", subtitle: ""},
    RETURNING_HERO: {title: ""},
    TEMPLATE_HERO: {title: () => ""},
}))
vi.mock("./components/HomeTaskComposer", () => ({default: nothing}))
vi.mock("./components/YourAgentsTable", () => ({default: nothing}))
vi.mock("./hooks/useAgentHomeActions", () => ({
    useAgentHomeActions: () => ({onCreate: onCreateMock}),
}))
vi.mock("./hooks/useAgentHomeVariants", () => ({
    useAgentHomeVariants: () => ({firstRunOverride: true, creatingAgent: true}),
}))
vi.mock("./hooks/useCreateAgentFromTemplate", () => ({
    useCreateAgentFromTemplate: () => ({createFromTemplate: vi.fn(), pendingKey: null}),
}))

import StripHome from "./StripHome"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const template = (key: string, name: string, slug: string) =>
    ({
        key,
        name,
        builderMessage: `Build the ${name}.`,
        connections: [{key: slug, primary: {slug}, required: true}],
    }) as unknown as AgentStarterTemplate

const PR_REVIEWER = template("pr-reviewer", "PR reviewer", "github")
const REPURPOSER = template("content-repurposer", "Content repurposer", "notion")

let root: Root | null = null
let host: HTMLDivElement | null = null

const navigate = async (templateKey?: string) => {
    routerState.query = templateKey ? {new: "1", template: templateKey} : {}
    await act(async () => {
        root?.render(createElement(StripHome))
    })
}

beforeEach(() => {
    templates.splice(0, templates.length, PR_REVIEWER, REPURPOSER)
    onCreateMock.mockReset()
    onCreateMock.mockResolvedValue(true)
    composer.text = ""
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => {
        root?.unmount()
        host?.remove()
    })
    root = null
    host = null
})

describe("StripHome template selection", () => {
    it("creates the newly picked template after switching from an open setup to one that skips it", async () => {
        await navigate("pr-reviewer")
        expect(composer.text).toBe("Build the PR reviewer.")

        // Home without dismissing the step, then a template with nothing left to connect.
        await navigate()
        await navigate("content-repurposer")
        expect(composer.text).toBe("Build the Content repurposer.")

        await act(async () => {
            await composer.onCreate?.()
        })

        expect(onCreateMock).toHaveBeenCalledTimes(1)
        const [name, , setup, created] = onCreateMock.mock.calls[0]
        expect(name).toBe("Content repurposer")
        expect(created).toBe(REPURPOSER)
        expect(setup.connectedSlugs).toEqual(["github", "notion"])
    })
})
