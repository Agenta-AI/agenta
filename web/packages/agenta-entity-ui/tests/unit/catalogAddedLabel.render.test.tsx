/**
 * The "Added" label on the integrations catalog, and the token it is painted with.
 *
 * It read `text-[var(--ag-colorSuccessText)]`, and `--ag-colorSuccessText` is declared in no
 * stylesheet in either app. A custom property that nothing declares produces an invalid
 * declaration rather than a wrong colour, so the label inherited the row's text colour and
 * nothing looked broken enough to notice: the MCP row's own success state rendered green
 * beside one that did not. This is the `--ag-colorLink` bug WP6 found on the tool row, and the
 * class form is the fix because a class that resolves to nothing at least emits no rule anyone
 * can mistake for one.
 *
 * It covered the subagent and skill pickers too, until main replaced both rows with a
 * whole-row toggle that tints the row instead of labelling it. Those two cases went with the
 * label they pinned; this is the one catalog that still has one.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {connections} = vi.hoisted(() => ({
    connections: [
        {
            slug: "github-main",
            integration_key: "github",
            provider_key: "composio",
            status: "ACTIVE",
        },
    ],
}))

// The catalog drawer reads the project's connections and the catalog through hooks over the
// network. Neither is this file's subject: what is asserted is the class on one label.
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
    useToolConnectionsQuery: () => ({connections}),
    useToolCatalogCategories: () => ({categories: [], isLoading: false}),
    useToolIntegrationDetail: () => ({integration: {name: "GitHub", categories: []}}),
}))

import {AgentIntegrationDrawer} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentIntegrationDrawer"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const mount = async (element: ReturnType<typeof createElement>) => {
    await act(async () => {
        root.render(element)
    })
}

/** The drawers are portalled, so the query is against the document, not the host node. */
const addedLabel = () =>
    [...document.querySelectorAll("span")].find(
        // The innermost one: each row wraps it in a span that reads the same.
        (node) => (node.textContent ?? "").trim() === "Added" && !node.querySelector("span"),
    )

const expectDeclaredToken = (label: Element | undefined, where: string) => {
    expect(label, `no Added label on ${where}`).toBeDefined()
    expect(label!.className, where).toContain("text-colorSuccess")
    expect(label!.className, where).not.toContain("--ag-colorSuccessText")
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
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

describe("the Added label on the catalog drawers", () => {
    it("is painted with a declared token on the integrations catalog", async () => {
        await mount(
            createElement(AgentIntegrationDrawer, {
                open: true,
                onClose: vi.fn(),
                integrationRows: [
                    {
                        provider: "composio",
                        integration: "github",
                        entry: null,
                        entryIndices: [0],
                        legacyIndices: [],
                        legacyConnections: [],
                    },
                ],
                onAddIntegration: vi.fn(),
            }),
        )

        expectDeclaredToken(addedLabel(), "the integrations catalog")
    })
})
