/**
 * "Add integration" in the agent editor: the connect dialog asks "Who can use it" as Settings
 * does, and "Only me" sets the item to each person's own account.
 */
import {act, createElement} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {accessAtom, dialog, catalog, personal} = vi.hoisted(() => ({
    personal: {connections: [] as unknown[]},
    // Stable across renders, as the real query's data is.
    catalog: {
        integrations: [{key: "gmail", name: "Gmail", auth_schemes: ["oauth"]}],
        connections: [] as unknown[],
        categories: [] as unknown[],
    },
    accessAtom: {current: null as unknown as PrimitiveAtom<string>},
    dialog: {props: null as null | Record<string, unknown>},
}))

vi.mock("@agenta/entities/secret", async () => {
    const {atom} = await import("jotai")
    accessAtom.current = atom("on")
    return {personalAccountsAccessAtom: accessAtom.current}
})

vi.mock("@agenta/entities/project", () => ({
    fetchProject: async () => ({project_name: "Support"}),
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

vi.mock("../../src/gatewayTool/drawers/ConnectDrawer", () => ({
    default: (props: Record<string, unknown>) => {
        dialog.props = props
        return null
    },
}))

import {AgentIntegrationDrawer} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentIntegrationDrawer"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onAddIntegration = vi.fn()
const onAddPersonalIntegration = vi.fn()

const openDialog = async (access: string) => {
    const store = createStore()
    store.set(accessAtom.current, access)
    await act(async () => {
        root.render(
            createElement(
                QueryClientProvider,
                {client: new QueryClient()},
                createElement(
                    Provider,
                    {store},
                    createElement(AgentIntegrationDrawer, {
                        open: true,
                        onClose: vi.fn(),
                        integrationRows: [],
                        onAddIntegration,
                        onAddPersonalIntegration,
                    }),
                ),
            ),
        )
    })
    const connect = document.querySelector<HTMLButtonElement>('button[aria-label="Connect Gmail"]')
    await act(async () => connect!.click())
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    dialog.props = null
    onAddIntegration.mockClear()
    onAddPersonalIntegration.mockClear()
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

describe("the connect dialog of the agent editor", () => {
    it("asks who can use it, with Only me first, when personal accounts are on", async () => {
        await openDialog("on")
        expect(dialog.props?.owners).toEqual(["user", "project"])
    })

    it("does not ask when personal accounts are off", async () => {
        await openDialog("off")
        expect(dialog.props?.owners).toBeUndefined()
    })

    it("Only me sets the item to each person's own account once the sign-in is valid", async () => {
        personal.connections = [
            {
                integration_key: "gmail",
                flags: {is_active: true, is_valid: true},
            },
        ]
        await openDialog("on")
        await act(async () => (dialog.props?.onSuccess as (owner: string) => void)("user"))
        expect(onAddPersonalIntegration).toHaveBeenCalledWith({
            provider: "composio",
            integration: "gmail",
        })
        expect(onAddIntegration).not.toHaveBeenCalled()
    })

    it("a closed popup with no valid sign-in adds nothing", async () => {
        personal.connections = []
        await openDialog("on")
        await act(async () => (dialog.props?.onSuccess as (owner: string) => void)("user"))
        expect(onAddPersonalIntegration).not.toHaveBeenCalled()
    })

    it("Everyone waits for the new connection and adds nothing personal", async () => {
        await openDialog("on")
        await act(async () => (dialog.props?.onSuccess as (owner: string) => void)("project"))
        expect(onAddPersonalIntegration).not.toHaveBeenCalled()
    })
})
