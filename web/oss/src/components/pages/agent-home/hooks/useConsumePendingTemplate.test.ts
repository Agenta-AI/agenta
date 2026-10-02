import {act, createElement} from "react"

import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {createAgentMock, warningMock, replaceMock, lookups, lookupAtoms, connectionsState} =
    vi.hoisted(() => ({
        createAgentMock: vi.fn(),
        warningMock: vi.fn(),
        replaceMock: vi.fn(),
        lookups: new Map<string, unknown>(),
        lookupAtoms: new Map<string, unknown>(),
        connectionsState: {connections: [] as unknown[], isLoading: false},
    }))

// Only what the hook uses; setupStepNeeded has its own unit tests.
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    interface Account {
        slug: string
        required: boolean
    }
    return {
        // Stable per key, like the real atomFamily; a fresh atom per render loops forever.
        agentTemplateLookupAtomFamily: (key: string) => {
            if (!lookupAtoms.has(key)) {
                lookupAtoms.set(
                    key,
                    atom(() => lookups.get(key) ?? {status: "missing"}),
                )
            }
            return lookupAtoms.get(key)
        },
        templateBuilderMessage: () => "",
        UNAVAILABLE_TEMPLATE_MESSAGE: "This template is not available.",
        detectAccounts: ({template}: {template: AgentStarterTemplate}) =>
            (template.connections ?? []).map((connection) => ({
                slug: connection.primary?.slug,
                required: connection.required,
            })),
        setupStepNeeded: ({
            accounts,
            connectedSlugs,
        }: {
            accounts: Account[]
            connectedSlugs: string[]
        }) => accounts.some((a) => a.required && !connectedSlugs.includes(a.slug)),
    }
})
vi.mock("@agenta/entities/gatewayTool", () => ({
    isConnectionActive: () => true,
    useToolConnectionsQuery: () => connectionsState,
}))
vi.mock("next/router", () => {
    const router = {replace: replaceMock}
    return {useRouter: () => router}
})
vi.mock("@/oss/state/url", async () => {
    const {atom} = await import("jotai")
    return {urlAtom: atom({baseAppURL: "/w/ws-1/p/project-1/apps"})}
})

vi.mock("./useCreateAgent", () => ({
    useCreateAgent: () => createAgentMock,
}))
vi.mock("@/oss/lib/helpers/analytics/hooks/usePostHogAg", () => ({
    usePostHogAg: () => null,
}))
vi.mock("@agenta/shared/analytics", () => ({
    captureFirstAgentIntent: vi.fn(),
}))
vi.mock("antd", () => {
    const app = {message: {warning: warningMock, error: vi.fn()}}
    return {App: {useApp: () => app}}
})
vi.mock("@/oss/state/appState", async () => {
    const {atom} = await import("jotai")
    return {appIdentifiersAtom: atom({workspaceId: "ws-1", projectId: "project-1"})}
})

import {activeTemplateAtom, persistTemplateToStorage} from "@/oss/state/url/template"

import {useConsumePendingTemplate} from "./useConsumePendingTemplate"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const TEMPLATE = {
    key: "pr-reviewer",
    name: "PR reviewer",
    category: "Engineering",
    overview: "Reviews pull requests.",
    source: {kind: "internal", key: "pr-reviewer"},
    connections: [{key: "repo", role: "read the diff", required: true, primary: {slug: "github"}}],
} as unknown as AgentStarterTemplate

let root: Root | null = null
let host: HTMLDivElement | null = null

const Harness = () => {
    useConsumePendingTemplate()
    return null
}

const arm = (key: string) => {
    const pending = {key, capturedAt: Date.now()}
    persistTemplateToStorage(pending)
    getDefaultStore().set(activeTemplateAtom, pending)
    return pending
}

const render = async () => {
    await act(async () => {
        root?.render(createElement(Harness))
    })
    // Let the claim + create promise chain settle.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

beforeEach(() => {
    window.localStorage.clear()
    getDefaultStore().set(activeTemplateAtom, null)
    createAgentMock.mockReset()
    warningMock.mockReset()
    replaceMock.mockReset()
    connectionsState.connections = [{integration_key: "github"}]
    connectionsState.isLoading = false
    lookups.clear()
    lookupAtoms.clear()
    lookups.set(TEMPLATE.key, {status: "found", template: TEMPLATE})
    createAgentMock.mockResolvedValue(true)
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

describe("useConsumePendingTemplate", () => {
    it("keeps the key and creates nothing while the catalog is still loading", async () => {
        lookups.set(TEMPLATE.key, {status: "pending"})
        arm(TEMPLATE.key)

        await render()

        expect(createAgentMock).not.toHaveBeenCalled()
        expect(warningMock).not.toHaveBeenCalled()
        expect(getDefaultStore().get(activeTemplateAtom)?.key).toBe(TEMPLATE.key)
    })

    it("creates the agent from the selected template package, not a blank seeded agent", async () => {
        arm(TEMPLATE.key)

        await render()

        expect(createAgentMock).toHaveBeenCalledTimes(1)
        const [params] = createAgentMock.mock.calls[0]
        expect(params.template).toBe(TEMPLATE)
        expect(params.seedMessage).toBeUndefined()
        expect(params.name).toBe(TEMPLATE.name)
    })

    it("binds the connected accounts when it skips the setup step", async () => {
        arm(TEMPLATE.key)

        await render()

        // `templateConnectionChoices` turns these connected slugs into gateway bindings; with no
        // setup it sent `kind: "skip"` for every connection.
        const [params] = createAgentMock.mock.calls[0]
        expect(params.setup).toEqual({
            accounts: [{slug: "github", required: true}],
            connectedSlugs: ["github"],
        })
    })

    it("opens the create surface's setup step when an account still needs connecting", async () => {
        connectionsState.connections = []
        arm(TEMPLATE.key)

        await render()

        expect(createAgentMock).not.toHaveBeenCalled()
        expect(replaceMock).toHaveBeenCalledWith(
            "/w/ws-1/p/project-1/apps?new=1&template=pr-reviewer",
        )
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()
    })

    it("waits for the workspace connections before deciding", async () => {
        connectionsState.isLoading = true
        arm(TEMPLATE.key)

        await render()

        expect(createAgentMock).not.toHaveBeenCalled()
        expect(replaceMock).not.toHaveBeenCalled()
        expect(getDefaultStore().get(activeTemplateAtom)?.key).toBe(TEMPLATE.key)
    })

    it("does not create a second agent when the same selection is consumed again", async () => {
        const pending = arm(TEMPLATE.key)
        await render()
        expect(createAgentMock).toHaveBeenCalledTimes(1)

        // A repeated auth callback or refresh re-arms the same captured generation on a fresh
        // mount of the consuming page.
        act(() => root?.unmount())
        root = createRoot(host as HTMLDivElement)
        persistTemplateToStorage(pending)
        getDefaultStore().set(activeTemplateAtom, {...pending})
        await render()

        expect(createAgentMock).toHaveBeenCalledTimes(1)
    })

    it("creates no blank or substitute agent for a key the catalog lacks", async () => {
        arm("not-a-real-template")

        await render()

        expect(createAgentMock).not.toHaveBeenCalled()
        expect(warningMock).toHaveBeenCalledWith("This template is not available.")
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()
    })
})
