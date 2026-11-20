/**
 * "Add integration" in the agent editor: Connect opens the connect form with "Who can use it" as
 * Settings asks it, and the catalog adds the connection the form made, and only that one.
 */
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {accessAtom, catalog, personal, writer} = vi.hoisted(() => ({
    personal: {connections: [] as unknown[]},
    // Stable across renders, as the real query's data is.
    catalog: {
        integrations: [{key: "gmail", name: "Gmail", auth_schemes: ["oauth"]}],
        connections: [] as unknown[],
        categories: [] as unknown[],
    },
    accessAtom: {current: null as unknown as PrimitiveAtom<string>},
    writer: {agent: {} as Record<string, unknown>, update: (() => undefined) as unknown},
}))

vi.mock("@agenta/entities/secret", async () => {
    const {atom} = await import("jotai")
    accessAtom.current = atom("on")
    return {personalAccountsAccessAtom: accessAtom.current}
})

vi.mock("@agenta/entities/project", () => ({
    fetchProject: async () => ({project_name: "Support"}),
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
    invalidateAgentRequirements: () => undefined,
}))

vi.mock("@agenta/entities/gatewayTool", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTool")>()),
    useToolCatalogIntegrations: () => ({
        integrations: catalog.integrations,
        total: 1,
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        requestMore: () => undefined,
        setCategory: () => undefined,
    }),
    useToolConnectionsQuery: () => ({connections: catalog.connections}),
    usePersonalToolConnections: () => ({connections: personal.connections}),
    useToolCatalogCategories: () => ({categories: catalog.categories, isLoading: false}),
    useToolIntegrationDetail: () => ({integration: {name: "Gmail", categories: []}}),
}))

// The add view's body is rendered alone here, with a push spy in place of its stack.
vi.mock("@agenta/ui/view-stack", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/view-stack")>()),
    useViewTitle: () => undefined,
}))

vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter", () => ({
    useAgentConfigWriter: () => writer,
}))

import {IntegrationCatalog} from "../../src/DrillInView/SchemaControls/agentTemplate/IntegrationCatalog"
import IntegrationAddViewBody from "../../src/DrillInView/SchemaControls/agentTemplate/views/IntegrationAddViewBody"
import {integrationConnectView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/integrationConnectView"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onAddIntegration = vi.fn()
const onAddPersonalIntegration = vi.fn()
const onConnect = vi.fn()

const render = async (element: ReturnType<typeof createElement>, store = createStore()) => {
    await act(async () => {
        root.render(
            createElement(
                QueryClientProvider,
                {client: new QueryClient()},
                createElement(Provider, {store}, element),
            ),
        )
    })
}

const catalogElement = () =>
    createElement(IntegrationCatalog, {
        integrationRows: [],
        onAddIntegration,
        onAddPersonalIntegration,
        onConnect,
    })

const clickConnect = async () => {
    const connect = document.querySelector<HTMLButtonElement>('button[aria-label="Connect Gmail"]')
    await act(async () => connect!.click())
}

const valid = {is_active: true, is_valid: true}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    catalog.connections = []
    personal.connections = []
    onAddIntegration.mockClear()
    onAddPersonalIntegration.mockClear()
    onConnect.mockClear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("Add integration: Connect, then attach", () => {
    it("pushes the connect view with the target project, asking who can use it when the switch is on", async () => {
        const push = vi.fn(async () => true)
        const store = createStore()
        store.set(accessAtom.current, "on")
        await render(
            createElement(IntegrationAddViewBody, {
                params: {},
                target: {kind: "agent_draft", revisionId: "rev-1"},
                nav: {depth: 1, push, back: async () => true, cancel: () => undefined},
            }),
            store,
        )
        await clickConnect()
        expect(push).toHaveBeenCalledWith(
            integrationConnectView,
            {integrationKey: "gmail", owners: ["user", "project"]},
            {kind: "project"},
        )
    })

    it("does not ask who can use it when personal accounts are off", async () => {
        const push = vi.fn(async () => true)
        const store = createStore()
        store.set(accessAtom.current, "off")
        await render(
            createElement(IntegrationAddViewBody, {
                params: {},
                target: {kind: "agent_draft", revisionId: "rev-1"},
                nav: {depth: 1, push, back: async () => true, cancel: () => undefined},
            }),
            store,
        )
        await clickConnect()
        expect(push.mock.calls[0][1]).toEqual({integrationKey: "gmail", owners: undefined})
    })

    it("adds the new project connection once it is valid, as a separate write", async () => {
        await render(catalogElement())
        await clickConnect()
        expect(onConnect).toHaveBeenCalledWith("gmail")
        expect(onAddIntegration).not.toHaveBeenCalled()

        // The connection exists before its sign-in finishes: not yet.
        catalog.connections = [
            {
                slug: "gmail-1",
                integration_key: "gmail",
                provider_key: "composio",
                flags: {is_active: true},
            },
        ]
        await render(catalogElement())
        expect(onAddIntegration).not.toHaveBeenCalled()

        catalog.connections = [
            {slug: "gmail-1", integration_key: "gmail", provider_key: "composio", flags: valid},
        ]
        await render(catalogElement())
        expect(onAddIntegration).toHaveBeenCalledWith(
            {provider: "composio", integration: "gmail"},
            "gmail-1",
        )
    })

    it("a connection that existed before Connect is not added", async () => {
        catalog.connections = [
            {slug: "gmail-old", integration_key: "gmail", provider_key: "composio", flags: valid},
        ]
        await render(catalogElement())
        await clickConnect()
        await render(catalogElement())
        expect(onAddIntegration).not.toHaveBeenCalled()
    })

    it("Only me: a new valid personal connection sets each person's own account", async () => {
        await render(catalogElement())
        await clickConnect()
        personal.connections = [{slug: "mine", integration_key: "gmail", flags: valid}]
        await render(catalogElement())
        expect(onAddPersonalIntegration).toHaveBeenCalledWith({
            provider: "composio",
            integration: "gmail",
        })
        expect(onAddIntegration).not.toHaveBeenCalled()
    })
})
