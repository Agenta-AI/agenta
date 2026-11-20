/**
 * The integration list as the Settings page mounts it (`layout="page"`): the person's own
 * accounts first with their default marked, the project group under the host's heading even when
 * empty, Run on a row click, and the category chips in place of the select.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const flags = {is_active: true, is_valid: true}

const {state} = vi.hoisted(() => ({
    state: {
        connections: [] as Record<string, unknown>[],
        personal: [] as Record<string, unknown>[] | null,
    },
}))

vi.mock("@agenta/entities/gatewayTool", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTool")>()),
    useToolCatalogIntegrations: () => ({
        integrations: [],
        total: 0,
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        requestMore: () => undefined,
        setCategory: () => undefined,
    }),
    useToolConnectionsQuery: () => ({connections: state.connections}),
    usePersonalToolConnections: () => ({connections: state.personal}),
    useToolCatalogCategories: () => ({
        categories: [{id: "crm", name: "crm"}],
        isLoading: false,
    }),
    useToolIntegrationDetail: (key: string) => ({
        integration: key ? {name: key === "gmail" ? "Gmail" : "GitHub", categories: []} : null,
    }),
}))

import {IntegrationCatalog} from "../../src/DrillInView/SchemaControls/agentTemplate/IntegrationCatalog"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const mount = async (element: ReturnType<typeof createElement>) => {
    await act(async () => {
        root.render(element)
    })
}

const text = () => document.body.textContent ?? ""

const yours = (overrides = {}) => ({
    label: "Yours",
    empty: createElement("p", null, "No accounts of your own"),
    makeDefault: {label: "Make default", defaultLabel: "Default", onMakeDefault: vi.fn()},
    ...overrides,
})

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    state.connections = []
    state.personal = []
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

describe("the integration list on the Settings page", () => {
    it("lists the person's own accounts first and marks the default", async () => {
        state.personal = [
            {
                id: "p1",
                slug: "gmail-me",
                name: "Me",
                integration_key: "gmail",
                flags,
                is_default: true,
            },
        ]
        await mount(
            createElement(IntegrationCatalog, {
                layout: "page",
                onConnect: vi.fn(),
                yours: yours(),
                connectedLabel: createElement("span", null, "Project Alpha"),
            }),
        )
        const body = text()
        expect(body.indexOf("Yours")).toBeGreaterThanOrEqual(0)
        expect(body.indexOf("Yours")).toBeLessThan(body.indexOf("Project Alpha"))
        expect(body).toContain("Me")
        expect(body).toContain("Default")
        expect(body).not.toContain("No accounts of your own")
    })

    it("keeps the project heading when the project has no accounts, and says Yours is empty", async () => {
        await mount(
            createElement(IntegrationCatalog, {
                layout: "page",
                onConnect: vi.fn(),
                yours: yours(),
                connectedLabel: createElement("span", null, "Project Alpha"),
            }),
        )
        expect(text()).toContain("Project Alpha")
        expect(text()).toContain("No accounts of your own")
    })

    it("shows a failed read in place of the empty note", async () => {
        state.personal = null
        await mount(
            createElement(IntegrationCatalog, {
                layout: "page",
                onConnect: vi.fn(),
                yours: yours({error: createElement("p", null, "Could not load")}),
            }),
        )
        expect(text()).toContain("Could not load")
        expect(text()).not.toContain("No accounts of your own")
    })

    it("runs a project connection from a row click", async () => {
        const connection = {
            id: "c1",
            slug: "github-main",
            name: "Main",
            integration_key: "github",
            provider_key: "composio",
            flags,
        }
        state.connections = [connection]
        const onRun = vi.fn()
        await mount(
            createElement(IntegrationCatalog, {
                layout: "page",
                onConnect: vi.fn(),
                run: {label: "Run action", onRun},
            }),
        )
        const row = [...document.querySelectorAll<HTMLElement>("[role=button]")].find((node) =>
            (node.textContent ?? "").includes("Main"),
        )
        expect(row).toBeDefined()
        await act(async () => row!.click())
        expect(onRun).toHaveBeenCalledWith(connection)
    })

    it("filters by category chips on a page and by a select in a panel", async () => {
        await mount(createElement(IntegrationCatalog, {layout: "page", onConnect: vi.fn()}))
        expect(document.querySelector("[role=toolbar]")).not.toBeNull()
        expect(document.querySelector("[aria-pressed=true]")?.textContent).toBe("All")

        await mount(createElement(IntegrationCatalog, {onConnect: vi.fn()}))
        expect(document.querySelector("[role=toolbar]")).toBeNull()
    })
})
