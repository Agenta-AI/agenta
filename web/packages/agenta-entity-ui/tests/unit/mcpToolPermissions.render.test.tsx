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
import {McpProtocolError, type McpServerPolicy} from "@agenta/entities/mcpEndpoint"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (
    policy: McpServerPolicy,
    onChange = vi.fn(),
    slug = "acme",
    extra: {connectionName?: string; onConnect?: () => void} = {},
) => {
    await act(async () => {
        root.render(createElement(McpToolPermissions, {slug, policy, onChange, ...extra}))
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

describe("switching connection while a tool list is in flight", () => {
    it("never shows one connection's tools under another's name", async () => {
        // The lists arrive whenever they arrive. Before this the slower answer overwrote the
        // faster one regardless of which connection had been asked for (M4).
        let releaseFirst: (tools: unknown) => void = () => undefined
        listMcpTools.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirst = resolve
                }),
        )
        listMcpTools.mockResolvedValueOnce([{name: "beta-only-tool"}])

        const onChange = vi.fn()
        await render({tool_permissions: {echo: "allow"}}, onChange, "alpha")
        await render({tool_permissions: {echo: "allow"}}, onChange, "beta")

        releaseFirst([{name: "alpha-only-tool"}])
        await act(async () => {
            await Promise.resolve()
        })

        expect(text()).toContain("beta-only-tool")
        expect(text()).not.toContain("alpha-only-tool")
    })
})

describe("a tool the filter hides that still holds a permission", () => {
    it("offers a way to remove it, because the API refuses the whole policy", async () => {
        await render({
            tools: {mode: "include", names: ["echo"]},
            tool_permissions: {echo: "allow", wipe: "deny"},
        })

        expect(text()).toContain("filter hides")
        expect(text()).toContain("cannot run until they are removed")
    })

    it("clears it when asked", async () => {
        const onChange = await render({
            tools: {mode: "include", names: ["echo"]},
            tool_permissions: {echo: "allow", wipe: "deny"},
        })

        const remove = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Remove",
        )
        await act(async () => {
            remove!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        expect(onChange).toHaveBeenCalledWith({
            tools: {mode: "include", names: ["echo"]},
            tool_permissions: {echo: "allow"},
        })
    })
})

describe("a catalogue too long to scroll", () => {
    const many = Array.from({length: 40}, (_, index) => ({
        name: `tool_${index}`,
        description: index === 7 ? "File a new issue in a team" : "Does a thing",
    }))

    it("offers a filter once there are enough tools to hunt through", async () => {
        listMcpTools.mockResolvedValue(many)

        await render({new_tool_permission: "ask"})

        // Linear advertises seventy-nine of these and every row rendered, so choosing what one
        // tool may do meant scrolling for it (UI QA round 3, scenario G).
        expect(host.querySelector('[aria-label="Filter tools"]')).not.toBeNull()
    })

    it("does not put a filter above a handful", async () => {
        await render({new_tool_permission: "ask"})

        // The default stub advertises two.
        expect(host.querySelector('[aria-label="Filter tools"]')).toBeNull()
    })

    it("narrows the rows to what was typed, by name or by what the tool does", async () => {
        listMcpTools.mockResolvedValue(many)
        await render({new_tool_permission: "ask"})

        const box = host.querySelector<HTMLInputElement>('[aria-label="Filter tools"]')!
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            )!.set!
            setter.call(box, "issue")
            box.dispatchEvent(new Event("input", {bubbles: true}))
        })

        expect(selectFor("Permission for tool_7")).not.toBeNull()
        expect(selectFor("Permission for tool_1")).toBeNull()
    })

    it("says the query matched nothing rather than looking like a server with no tools", async () => {
        listMcpTools.mockResolvedValue(many)
        await render({new_tool_permission: "ask"})

        const box = host.querySelector<HTMLInputElement>('[aria-label="Filter tools"]')!
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            )!.set!
            setter.call(box, "nothing-matches-this")
            box.dispatchEvent(new Event("input", {bubbles: true}))
        })

        expect(text()).toContain("No tool here matches that")
        expect(text()).not.toContain("exposes no tools yet")
    })
})

describe("rules for tools that are no longer advertised", () => {
    it("are shown rather than dropped, so a decision survives a server blip", async () => {
        await render({tool_permissions: {echo: "allow", gone: "deny"}})

        expect(text()).toContain("no longer advertises")
        expect(text()).toContain("gone")
    })
})

describe("when the server has not been authorized", () => {
    // The error the tool-list client actually throws. It used to be stubbed with an
    // axios-shaped object, which that function cannot produce: the response is read and
    // discarded at the throw, so both cases below passed against a shape that never reaches
    // them and neither half could fire in front of a person (D50).
    const authRefusal = new McpProtocolError(
        "Authorization required for custom/acme",
        "auth_required",
    )

    it("names the connection instead of a route and a code", async () => {
        listMcpTools.mockRejectedValue(authRefusal)

        await render({tool_permissions: {echo: "allow"}}, vi.fn(), "acme", {
            connectionName: "Acme (prod)",
        })

        expect(text()).toContain("Acme (prod)")
        expect(text()).not.toContain("agenta_code")
        expect(text()).not.toContain("custom/acme")
    })

    it("offers the action that fixes it rather than a retry that cannot", async () => {
        listMcpTools.mockRejectedValue(authRefusal)
        const onConnect = vi.fn()

        await render({tool_permissions: {echo: "allow"}}, vi.fn(), "acme", {
            connectionName: "Acme (prod)",
            onConnect,
        })

        const connect = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Connect",
        )
        expect(connect).toBeDefined()
        expect(
            [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry tools"),
        ).toBeUndefined()

        await act(async () => {
            connect!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        expect(onConnect).toHaveBeenCalled()
    })
})

describe("when the tool list cannot be read", () => {
    it("says so in the gateway's own words, and offers to try again", async () => {
        listMcpTools.mockRejectedValue({
            response: {data: {detail: {message: "The server did not answer."}}},
        })
        const onChange = await render({tool_permissions: {echo: "allow"}})

        expect(text()).toContain("The server did not answer.")
        expect(text()).toContain("Retry tools")
        expect(onChange).not.toHaveBeenCalled()
    })

    it("says something readable when the failure carries no sentence at all", async () => {
        // A transport error's own message is "Request failed with status code 424", which is
        // a number where a reason belongs, so it is not what gets shown.
        listMcpTools.mockRejectedValue(new Error("Request failed with status code 424"))
        await render({tool_permissions: {echo: "allow"}})

        expect(text()).toContain("The tool list could not be read.")
        expect(text()).not.toContain("status code 424")
    })
})

describe("before a connection is chosen", () => {
    it("asks for one instead of showing an empty table", async () => {
        await render({}, vi.fn(), "")

        expect(text()).toContain("Select a connection")
        expect(listMcpTools).not.toHaveBeenCalled()
    })
})
