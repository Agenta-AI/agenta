/**
 * What a row says about a saved rule whose tool the source no longer lists.
 *
 * The two sources say it differently, and have to. A Composio integration publishes a catalog, so a
 * key missing from it is "not in catalog". An MCP server has no catalog: it advertises a tool list,
 * and a key missing from that list is one the server has stopped offering, which is the spec's own
 * phrase. The MCP wording is pinned beside its own drawer; this pins that giving a source its own
 * wording did not quietly give every source the MCP one.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {IntegrationPermissionDrawer} from "../../src/DrillInView/SchemaControls/agentTemplate/IntegrationPermissionDrawer"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

/** A source that names no wording of its own, which is every source but the MCP one. */
const render = async () => {
    await act(async () => {
        root.render(
            createElement(IntegrationPermissionDrawer, {
                open: true,
                onClose: () => undefined,
                target: {provider: "composio", integration: "linear"},
                connectionSlug: "linear-main",
                // A rule for a tool the source does not list, against a complete catalog, which is
                // the only state in which a saved key may be called stale at all.
                permissions: {default: "allow", tools: {retired_tool: "deny"}},
                onChangePermissions: () => undefined,
                onChangeToolPermission: () => undefined,
                source: {
                    catalogKey: "linear",
                    title: "Linear",
                    emptyLabel: "No tools listed.",
                    catalog: {
                        status: "ready",
                        complete: true,
                        tools: [{key: "get_issue", name: "Get issue"}],
                    },
                },
            }),
        )
    })
}

describe("a saved rule whose tool the source stopped listing", () => {
    it("keeps the catalog wording for a source that names none of its own", async () => {
        await render()

        expect(document.body.textContent).toContain("not in catalog")
        expect(document.body.textContent).not.toContain("no longer offered")
    })
})
