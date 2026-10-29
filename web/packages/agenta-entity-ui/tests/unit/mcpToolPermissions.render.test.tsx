/**
 * The five things the per-tool editor has to say on screen, carried over to the drawer that
 * replaced it.
 *
 * Each was a fix for a reported problem and each is invisible from a mockup, so each survives the
 * port with its own case: a filter-hidden tool looking assignable when the API would refuse the
 * whole policy, a tool with no rule looking unrestricted, a filtered row showing no matching text,
 * an unauthorized server offered a retry that cannot work, and an agent written before per-tool
 * policy existed quietly gaining a table.
 *
 * The drawer renders through a portal, so every query here goes to the document rather than to the
 * host node. A query scoped to the host finds nothing and the symptom reads as a component that
 * rendered nothing at all.
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

import McpPermissionDrawer from "../../src/mcpEndpoint/McpPermissionDrawer"
import {McpProtocolError, type McpServerPolicy} from "@agenta/entities/mcpEndpoint"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (
    policy: McpServerPolicy,
    onChange = vi.fn(),
    slug = "acme",
    extra: Partial<Parameters<typeof McpPermissionDrawer>[0]> = {},
) => {
    await act(async () => {
        root.render(
            createElement(McpPermissionDrawer, {
                open: true,
                onClose: () => undefined,
                slug,
                policy,
                onChange,
                ...extra,
            }),
        )
    })
    return onChange
}

const text = () => document.body.textContent ?? ""

const selectFor = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

const click = async (element: Element | undefined) => {
    await act(async () => {
        element!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
}

/** Type into the search box the way a person does, through the real input event. */
const typeSearch = async (value: string) => {
    const box = document.querySelector<HTMLInputElement>('input[aria-label="Search tools"]')!
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
        )!.set!
        setter.call(box, value)
        box.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

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

describe("a tool with no rule of its own", () => {
    it("says what it inherits, rather than showing a bare value", async () => {
        // Without this the row reads as unrestricted, which is the opposite of the truth.
        await render({tool_permissions: {echo: "allow"}})

        expect(selectFor("Permission for wipe")?.textContent).toContain("Inherits ask")
    })

    it("says Ask for an unnamed tool even when the server permission is allow", async () => {
        // The discriminating shape: a per-tool table BESIDE a server permission. The runner's gate
        // never consults the whole-server permission once a table is declared — a human decides for
        // anything the table does not name — so a server set to allow must still read Ask here, or
        // the label promises a tool will run unapproved when the run will stop and ask (D88).
        await render({tool_permissions: {echo: "allow"}, permission: "allow"})

        expect(selectFor("Permission for wipe")?.textContent).toContain("Inherits ask")
        expect(selectFor("Permission for wipe")?.textContent).not.toContain("Inherits allow")
    })

    it("names the server permission while no table is declared", async () => {
        // With nothing per-tool written, the whole-server permission really is what an unnamed
        // tool gets, and the row has to say so rather than repeating the floor.
        await render({permission: "allow"})

        expect(selectFor("Permission for echo")?.textContent).toContain("Inherits allow")
    })
})

describe("a tool the include filter hides", () => {
    const filtered: McpServerPolicy = {
        tools: {mode: "include", names: ["echo"]},
        tool_permissions: {echo: "allow"},
    }

    it("cannot be assigned one, because the API refuses the whole policy", async () => {
        await render(filtered)

        expect(selectFor("Permission for wipe")?.getAttribute("disabled")).not.toBeNull()
        expect(text()).toContain("Hidden by this server's tool filter")
    })

    it("leaves the admitted tool assignable", async () => {
        await render(filtered)

        expect(selectFor("Permission for echo")?.getAttribute("disabled")).toBeNull()
    })
})

describe("a tool the filter hides that still holds a permission", () => {
    const stranded: McpServerPolicy = {
        tools: {mode: "include", names: ["echo"]},
        tool_permissions: {echo: "allow", wipe: "deny"},
    }

    it("offers a way to remove it, because the row's own control is disabled", async () => {
        await render(stranded)

        expect(text()).toContain("filter hides")
        expect(text()).toContain("cannot run until they are removed")
    })

    it("clears it when asked", async () => {
        const onChange = await render(stranded)

        await click(button("Remove"))

        expect(onChange).toHaveBeenCalledWith({
            tools: {mode: "include", names: ["echo"]},
            tool_permissions: {echo: "allow"},
        })
    })
})

describe("a row that survived a search", () => {
    const many = Array.from({length: 40}, (_, index) => ({
        name: `tool_${index}`,
        description: index === 7 ? "File a new issue in a team" : "Does a thing",
    }))

    it("shows the description it was matched on, so the result is explainable", async () => {
        // The search matches a description as well as a name. Typing "screenshot" once kept one row
        // called `extract_images` whose visible text contained no such word, and it looked like a
        // bug (round 4, D6).
        listMcpTools.mockResolvedValue(many)
        await render({new_tool_permission: "ask"})

        await typeSearch("issue")

        expect(selectFor("Permission for tool_7")).not.toBeNull()
        expect(selectFor("Permission for tool_1")).toBeNull()
        expect(text()).toContain("File a new issue in a team")
    })
})

describe("switching connection while a tool list is in flight", () => {
    it("never shows one connection's tools under another's name", async () => {
        // The lists arrive whenever they arrive. Before this the slower answer overwrote the faster
        // one regardless of which connection had been asked for (M4).
        let releaseFirst: (tools: unknown) => void = () => undefined
        listMcpTools.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirst = resolve
                }),
        )
        listMcpTools.mockResolvedValueOnce([{name: "beta_only_tool"}])

        const onChange = vi.fn()
        await render({tool_permissions: {echo: "allow"}}, onChange, "alpha")
        await render({tool_permissions: {echo: "allow"}}, onChange, "beta")

        releaseFirst([{name: "alpha_only_tool"}])
        await act(async () => {
            await Promise.resolve()
        })

        expect(text()).toContain("beta_only_tool")
        expect(text()).not.toContain("alpha_only_tool")
    })
})

describe("when the server has not been authorized", () => {
    // The error the tool-list client actually throws. An axios-shaped stub cannot reach this
    // component: the response is read and discarded at the throw (D50).
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
        const onReconnect = vi.fn()

        await render({tool_permissions: {echo: "allow"}}, vi.fn(), "acme", {
            connectionName: "Acme (prod)",
            onReconnect,
        })

        expect(button("Connect")).toBeDefined()
        expect(button("Retry tools")).toBeUndefined()

        await click(button("Connect"))
        expect(onReconnect).toHaveBeenCalled()
    })
})

describe("when the tool list cannot be read", () => {
    it("says so in the gateway's own words, and offers to try again", async () => {
        listMcpTools.mockRejectedValue(new McpProtocolError("The server did not answer."))
        const onChange = await render({tool_permissions: {echo: "allow"}})

        expect(text()).toContain("The server did not answer.")
        expect(button("Retry tools")).toBeDefined()
        expect(onChange).not.toHaveBeenCalled()
    })

    it("says something readable when the failure carries no sentence at all", async () => {
        // A transport error's own message is "Request failed with status code 424", which is a
        // number where a reason belongs, so it is not what gets shown.
        listMcpTools.mockRejectedValue(new Error("Request failed with status code 424"))
        await render({tool_permissions: {echo: "allow"}})

        expect(text()).toContain("The tool list could not be read.")
        expect(text()).not.toContain("status code 424")
    })
})

describe("an agent configured before per-tool policy existed", () => {
    it("is not given a table by the drawer merely opening on it", async () => {
        const onChange = await render({permission: "allow"})

        expect(onChange).not.toHaveBeenCalled()
    })

    it("reads its whole-server permission back as a preset, with nothing per-tool on screen", async () => {
        // The drawer opens on a policy that has no table. It must read as "Allow all" rather than
        // as the Custom that a table would produce, or an author would think they had overrides
        // they never wrote. The write path itself is pinned in mcpPermissionAdapter.test.ts.
        await render({permission: "allow"})

        expect(selectFor("Default permission")?.textContent).toContain("Allow all")
        expect(selectFor("Default permission")?.textContent).not.toContain("Custom")
    })
})

describe("before a connection is chosen", () => {
    it("asks for one instead of showing an empty table", async () => {
        await render({}, vi.fn(), "")

        expect(text()).toContain("Select a connection")
        expect(listMcpTools).not.toHaveBeenCalled()
    })
})
