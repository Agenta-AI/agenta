/**
 * What the per-tool editor has to say on screen, not just compute.
 *
 * Each of these is a case where a table that reads as safe would not be: a tool with no rule
 * looking unrestricted, an opted-out server looking like it has rules, and a filter-hidden
 * tool looking assignable when the API would refuse the whole policy.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {listMcpTools} = vi.hoisted(() => ({listMcpTools: vi.fn()}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    // The policy model is the code under test; only the network call is stubbed.
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    listMcpTools,
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
}))

import McpToolPermissions from "../../src/mcpEndpoint/McpToolPermissions"
import type {McpServerPolicy} from "@agenta/entities/mcpEndpoint"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (policy: McpServerPolicy, onChange = vi.fn(), slug = "acme") => {
    await act(async () => {
        root.render(createElement(McpToolPermissions, {slug, policy, onChange}))
    })
    return onChange
}

const text = () => host.textContent ?? ""

const selectFor = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    listMcpTools.mockResolvedValue([
        {name: "echo", description: "Echo it back"},
        {name: "wipe", description: "Delete everything"},
    ])
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("while the per-tool table is off", () => {
    it("says the server's own permission governs, and offers to opt in", async () => {
        await render({permission: "allow"})

        expect(text()).toContain("follows the server")
        expect(text()).toContain("Set permissions per tool")
    })

    it("writes nothing per-tool until someone opts in", async () => {
        const onChange = await render({permission: "allow"})

        const optIn = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Set permissions per tool",
        )
        await act(async () => {
            optIn!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        // `ask` is the floor for a tool nobody has looked at, so opting in cannot widen.
        expect(onChange).toHaveBeenCalledWith({permission: "allow", new_tool_permission: "ask"})
    })
})

describe("once the table is on", () => {
    const policy: McpServerPolicy = {tool_permissions: {echo: "allow"}}

    it("says what a tool with no rule of its own gets", async () => {
        await render(policy)

        // Without this the row reads as unrestricted, which is the opposite of the truth.
        expect(text()).toContain("Inherits ask")
        expect(selectFor("Permission for a tool with no rule")).not.toBeNull()
    })

    it("offers a control for every advertised tool", async () => {
        await render(policy)

        expect(selectFor("Permission for echo")).not.toBeNull()
        expect(selectFor("Permission for wipe")).not.toBeNull()
    })

    it("shows the tool names the server advertises, never a rendered one", async () => {
        await render(policy)

        expect(text()).toContain("echo")
        expect(text()).not.toContain("mcp__")
    })

    it("offers a way back to the whole-server permission", async () => {
        const onChange = await render({permission: "deny", ...policy})

        const revert = [...host.querySelectorAll("button")].find((button) =>
            button.textContent?.includes("server permission instead"),
        )
        await act(async () => {
            revert!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(onChange).toHaveBeenCalledWith({permission: "deny"})
    })
})

describe("a tool the include filter hides", () => {
    const filtered: McpServerPolicy = {
        tools: {mode: "include", names: ["echo"]},
        tool_permissions: {echo: "allow"},
    }

    it("cannot be assigned one, because the API refuses the whole policy", async () => {
        await render(filtered)

        const hidden = selectFor("Permission for wipe")
        expect(hidden?.getAttribute("disabled")).not.toBeNull()
        expect(text()).toContain("Hidden by this server's tool filter")
    })

    it("leaves the admitted tool assignable", async () => {
        await render(filtered)

        expect(selectFor("Permission for echo")?.getAttribute("disabled")).toBeNull()
    })
})

describe("rules for tools that are no longer advertised", () => {
    it("are shown rather than dropped, so a decision survives a server blip", async () => {
        await render({tool_permissions: {echo: "allow", gone: "deny"}})

        expect(text()).toContain("no longer advertises")
        expect(text()).toContain("gone")
    })
})

describe("when the tool list cannot be read", () => {
    it("says so and offers to try again, without touching the policy", async () => {
        listMcpTools.mockRejectedValue(new Error("The server did not answer."))
        const onChange = await render({tool_permissions: {echo: "allow"}})

        expect(text()).toContain("The server did not answer.")
        expect(text()).toContain("Retry tools")
        expect(onChange).not.toHaveBeenCalled()
    })
})

describe("before a connection is chosen", () => {
    it("asks for one instead of showing an empty table", async () => {
        await render({}, vi.fn(), "")

        expect(text()).toContain("Select a connection")
        expect(listMcpTools).not.toHaveBeenCalled()
    })
})
