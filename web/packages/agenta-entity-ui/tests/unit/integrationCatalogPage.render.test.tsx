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
        connectionsLoading: false,
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
    // While loading, the real hook hands a new empty list on every render.
    useToolConnectionsQuery: () =>
        state.connectionsLoading
            ? {connections: [], isLoading: true}
            : {connections: state.connections, isLoading: false},
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

const click = async (el: HTMLElement) => {
    await act(async () => {
        el.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, button: 0}))
        el.click()
    })
}

const button = (label: string) =>
    [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(
        (node) => (node.textContent ?? "").trim() === label,
    )

const yours = (overrides = {}) => ({
    label: "Yours",
    empty: createElement("p", null, "No accounts of your own"),
    makeDefault: {label: "Make default", defaultLabel: "Default", onMakeDefault: vi.fn()},
    ...overrides,
})

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    // jsdom has no scrolling; the chip row keeps its selected chip in view.
    Element.prototype.scrollIntoView = vi.fn()
    state.connections = []
    state.connectionsLoading = false
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
                projectHeading: createElement("span", null, "Project Alpha"),
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
                projectHeading: createElement("span", null, "Project Alpha"),
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

    it("picks a category with the chips on a page and keeps the select in a panel", async () => {
        await mount(createElement(IntegrationCatalog, {layout: "page", onConnect: vi.fn()}))
        expect(document.querySelector("[role=toolbar]")).not.toBeNull()
        expect(document.querySelector("[aria-pressed=true]")?.textContent).toBe("All")
        const crm = [...document.querySelectorAll<HTMLElement>("[aria-pressed]")].find(
            (chip) => chip.textContent === "CRM",
        )
        await click(crm!)
        expect(document.querySelector("[aria-pressed=true]")?.textContent).toBe("CRM")

        await mount(createElement(IntegrationCatalog, {onConnect: vi.fn()}))
        expect(document.querySelector("[role=toolbar]")).toBeNull()
    })

    it("offers Make default on the person's own working account that is not the default", async () => {
        const mine = {id: "p2", slug: "gmail-work", name: "Work", integration_key: "gmail", flags}
        state.personal = [mine]
        const onMakeDefault = vi.fn()
        await mount(
            createElement(IntegrationCatalog, {
                layout: "page",
                onConnect: vi.fn(),
                yours: yours({
                    makeDefault: {label: "Make default", defaultLabel: "Default", onMakeDefault},
                }),
            }),
        )
        await click(document.querySelector<HTMLElement>("[aria-label='Connection actions']")!)
        await click(button("Make default")!)
        expect(onMakeDefault).toHaveBeenCalledWith(mine)
    })

    it("hands Delete to the host's own confirm, from the finish sign-in dialog", async () => {
        const pending = {
            id: "c2",
            slug: "github-new",
            name: "New",
            integration_key: "github",
            provider_key: "composio",
            flags: {is_active: true, is_valid: false},
        }
        state.connections = [pending]
        const confirmConnectionAction = vi.fn()
        await mount(
            createElement(IntegrationCatalog, {
                layout: "page",
                onConnect: vi.fn(),
                confirmConnectionAction,
            }),
        )
        const row = [...document.querySelectorAll<HTMLElement>("[role=button]")].find((node) =>
            (node.textContent ?? "").includes("New"),
        )
        await act(async () => row!.click())
        await click(button("Delete")!)
        expect(confirmConnectionAction).toHaveBeenCalledWith("delete", pending)
        // The catalog runs no dialog of its own.
        expect(text()).not.toContain("Delete connection:")
    })

    // A new atom per render loops through useAtomValue; with the old code this case never ends.
    it("settles while the connections load, through a chip and a search", async () => {
        state.connectionsLoading = true
        state.personal = [{id: "p1", slug: "gmail-me", name: "Me", integration_key: "gmail", flags}]
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mount(
            createElement(IntegrationCatalog, {
                layout: "page",
                onConnect: vi.fn(),
                yours: yours(),
                projectHeading: createElement("span", null, "Project Alpha"),
            }),
        )
        // No pinned heading over a list that has not loaded.
        expect(text()).not.toContain("Project Alpha")
        const crm = [...document.querySelectorAll<HTMLElement>("[aria-pressed]")].find(
            (chip) => chip.textContent === "CRM",
        )
        await click(crm!)
        const search = document.querySelector<HTMLInputElement>("input")!
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(search, "gm")
            search.dispatchEvent(new Event("input", {bubbles: true}))
        })
        const loops = errors.mock.calls.filter((call) =>
            String(call[0]).includes("Maximum update depth"),
        )
        errors.mockRestore()
        expect(loops).toEqual([])
    })
})
