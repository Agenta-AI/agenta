/**
 * The agent rail's MCP servers section: what it counts, what it marks, and where a row goes.
 *
 * The routing cases are the ones worth pinning. A row that resolves to a live connection has
 * nothing left to configure but its permissions, so sending it through the form first was a
 * second navigation for one intent. A row that does NOT resolve has to keep going to the
 * form, because the form's notices are the only explanation of the problem and the only
 * repair; routing it to a permission drawer would strand it with no way back.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {countSummary} from "../../src/DrillInView/SchemaControls/agentTemplate/agentTemplateUtils"
import {ConfigItemList} from "../../src/DrillInView/SchemaControls/agentTemplate/ConfigItemList"
import type {ItemRowStatus} from "../../src/DrillInView/SchemaControls/agentTemplate/ItemRow"
import {
    mcpItemNeedsRepair,
    mcpLoginExpired,
} from "../../src/DrillInView/SchemaControls/agentTemplate/mcpRail"

import {StatusIndicator} from "@agenta/ui/components/presentational"
import {
    readMcpConnectionSlug,
    RESERVED_TOOL_PREFIX,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"

/** A saved agent item pointing at a project connection. */
const item = (name: string, slug: string) => ({
    name,
    connection: {type: "gateway", namespace: "custom", slug},
    policy: {tools: {mode: "all"}, permission: "allow"},
})

const LINEAR = item("linear", "linear")
const OCTOLENS = item("octolens", "octolens")

/** A registered connection, in the two health states the product can tell apart. */
const endpoint = (slug: string, {expired = false} = {}): MCPEndpoint => ({
    id: `mcp-${slug}`,
    slug,
    name: slug,
    auth_mode: "oauth",
    namespace: "custom",
    // A usable secret is what "connected" is derived from; an expired login has none.
    secret_id: expired ? null : `secret-${slug}`,
    data: {route: {base_url: `https://mcp.${slug}.test`}},
})

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

/**
 * The section body as AgentTemplateControl composes it: the shared list, plus the two
 * per-row functions the control supplies for health. Composed here rather than mounting
 * the whole control, which needs the drill-in context, jotai and a resolved schema.
 */
const renderSection = async ({
    items,
    registry = new Set(["linear", "octolens"]),
    expired = new Set<string>(),
    openEdit = vi.fn(),
    openPermissions = vi.fn(),
}: {
    items: Record<string, unknown>[]
    /** The slugs the project actually has, so a row can name one that is gone. */
    registry?: Set<string>
    expired?: Set<string>
    openEdit?: ReturnType<typeof vi.fn>
    openPermissions?: ReturnType<typeof vi.fn>
}) => {
    /**
     * The project registry this agent's rows resolve against. The slug comes from
     * readMcpConnectionSlug, which is what the panel uses: a legacy item resolves through
     * its name, so it can name a live connection and still need repairing.
     */
    const endpointFor = (row: unknown) => {
        const slug = readMcpConnectionSlug((row ?? {}) as Record<string, unknown>)
        if (!slug || !registry.has(slug)) return undefined
        return endpoint(slug, {expired: expired.has(slug)})
    }
    const loginExpired = (row: unknown) => mcpLoginExpired(endpointFor(row))

    await act(async () => {
        root.render(
            createElement(ConfigItemList, {
                kind: "mcp",
                items,
                // The panel's own rule, not a description of it: mcpItemNeedsRepair is
                // the function AgentTemplateControl calls on a row click.
                openEdit: (kind, index, row) =>
                    mcpItemNeedsRepair(row as Record<string, unknown>, endpointFor(row))
                        ? openEdit(kind, index, row)
                        : openPermissions(index),
                removeItem: vi.fn(),
                closeEditor: vi.fn(),
                emptyAdd: null,
                statusFor: (row): ItemRowStatus | undefined =>
                    loginExpired(row) ? {tone: "incomplete"} : undefined,
                extraFor: (row) =>
                    loginExpired(row)
                        ? createElement(StatusIndicator, {
                              tone: "warning",
                              label: "Login expired",
                              className: "text-xs",
                          })
                        : undefined,
            }),
        )
    })
    return {openEdit, openPermissions}
}

const rowNodes = () => [...host.querySelectorAll<HTMLElement>("div.group")]

const clickRow = async (index: number) => {
    const opener = rowNodes()[index]!.querySelector<HTMLElement>('[role="button"]')
    expect(opener, "row has no keyboard-reachable opener").not.toBeNull()
    await act(async () => {
        opener!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
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

describe("the MCP section's count line", () => {
    it("says None, one server, or a plural", () => {
        expect(countSummary(0, "server")).toBe("None")
        expect(countSummary(1, "server")).toBe("1 server")
        expect(countSummary(2, "server")).toBe("2 servers")
    })
})

describe("the MCP rail rows", () => {
    it("says nothing at all about a healthy connection", async () => {
        await renderSection({items: [LINEAR]})

        expect(host.textContent).toContain("linear")
        // Not "Connected", not a tag: a state on every row teaches the reader to skip it.
        expect(host.textContent).not.toContain("Connected")
        expect(host.querySelector(".ant-tag")).toBeNull()
        expect(rowNodes()[0]!.getAttribute("style") ?? "").not.toContain("Warning")
    })

    it("marks an expired connection with a warning border and the state in words", async () => {
        await renderSection({items: [LINEAR, OCTOLENS], expired: new Set(["octolens"])})

        expect(rowNodes()[1]!.getAttribute("style")).toContain("colorWarningBorder")
        expect(rowNodes()[1]!.textContent).toContain("Login expired")
        // The healthy row beside it stays unmarked, so the mark means something.
        expect(rowNodes()[0]!.getAttribute("style") ?? "").not.toContain("colorWarningBorder")
        expect(rowNodes()[0]!.textContent).not.toContain("Login expired")
    })

    it("states the expiry once, not as a tag and a line saying the same thing", async () => {
        await renderSection({items: [OCTOLENS], expired: new Set(["octolens"])})

        const occurrences = (rowNodes()[0]!.textContent ?? "").split("Login expired").length - 1
        expect(occurrences).toBe(1)
    })

    it("keeps the Remove control on every row", async () => {
        await renderSection({items: [LINEAR, OCTOLENS], expired: new Set(["octolens"])})

        expect(host.querySelectorAll('button[aria-label="Remove"]')).toHaveLength(2)
    })
})

describe("where an MCP rail row goes", () => {
    it("opens permissions directly for a row that resolves to a connection", async () => {
        const {openPermissions, openEdit} = await renderSection({items: [LINEAR]})

        await clickRow(0)

        expect(openPermissions).toHaveBeenCalledWith(0)
        expect(openEdit).not.toHaveBeenCalled()
    })

    it("opens permissions for an expired row too, which is where Reconnect lives", async () => {
        const {openPermissions} = await renderSection({
            items: [OCTOLENS],
            expired: new Set(["octolens"]),
        })

        await clickRow(0)

        expect(openPermissions).toHaveBeenCalledWith(0)
    })

    it("sends a row naming a connection the project no longer has to the form", async () => {
        const {openPermissions, openEdit} = await renderSection({
            items: [item("gone", "gone")],
        })

        await clickRow(0)

        expect(openEdit).toHaveBeenCalledOnce()
        expect(openPermissions).not.toHaveBeenCalled()
    })

    it("sends a server saved before shared connections to the form, even though it resolves", async () => {
        // The legacy shape resolves through its name, so this row does find a live
        // connection. It still has to be migrated, and only the form says so.
        const {openPermissions, openEdit} = await renderSection({
            items: [{name: "linear", connection: {type: "http", url: "https://mcp.linear.app"}}],
        })

        await clickRow(0)

        expect(openEdit).toHaveBeenCalledOnce()
        expect(openPermissions).not.toHaveBeenCalled()
    })

    it("sends a row on the reserved prefix to the form, where the error is stated", async () => {
        const {openPermissions, openEdit} = await renderSection({
            items: [{...item("x", "linear"), name: RESERVED_TOOL_PREFIX}],
        })

        await clickRow(0)

        expect(openEdit).toHaveBeenCalledOnce()
        expect(openPermissions).not.toHaveBeenCalled()
    })
})
