/**
 * The permission drawer, screen by screen.
 *
 * What an author decides here is what an agent is allowed to do on somebody else's server, so the
 * screen has to say the whole truth: which server, whether its login still works, what the default
 * is, which tools carry a rule of their own, and how many. Each case below is one of those
 * sentences.
 *
 * The drawer renders through a portal, so every query goes to the document rather than to the host
 * node. A query scoped to the host finds nothing and the symptom reads as a component that rendered
 * nothing at all.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {listMcpTools} = vi.hoisted(() => ({listMcpTools: vi.fn()}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    listMcpTools,
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
}))

import McpPermissionDrawer from "../../src/mcpEndpoint/McpPermissionDrawer"
import type {McpServerPolicy} from "@agenta/entities/mcpEndpoint"

/** The nine tools the spec's own data block supplies, read-only group then write group. */
const LINEAR_TOOLS = [
    {
        name: "get_current_user",
        title: "Get current user",
        description: "Gets the authenticated user's ID, name, email, and profile information.",
        annotations: {readOnlyHint: true},
    },
    {
        name: "get_issue",
        title: "Get Linear issue",
        description:
            "Retrieves an issue's details, including id, identifier, title, state, and assignee.",
        annotations: {readOnlyHint: true},
    },
    {
        name: "list_issues",
        title: "List Linear issues",
        description:
            "Lists non-archived issues; if project_id is not specified, issues from all projects.",
        annotations: {readOnlyHint: true},
    },
    {
        name: "list_comments",
        title: "List comments",
        description:
            "Lists comments from the Linear workspace accessible to the authenticated user.",
        annotations: {readOnlyHint: true},
    },
    {
        name: "create_issue",
        title: "Create issue",
        description:
            "Creates a new issue in a team with title, description, priority, and assignee.",
        annotations: {readOnlyHint: false},
    },
    {
        name: "update_issue",
        title: "Update issue",
        description: "Updates an existing issue's fields, including state, assignee, and labels.",
        annotations: {readOnlyHint: false},
    },
    {
        name: "create_comment",
        title: "Create comment",
        description: "Adds a comment to an issue on behalf of the authenticated user.",
        annotations: {readOnlyHint: false},
    },
    {
        name: "delete_issue",
        title: "Delete issue",
        description: "Permanently deletes an issue. This cannot be undone.",
        annotations: {readOnlyHint: false},
    },
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (extra: Partial<Parameters<typeof McpPermissionDrawer>[0]> = {}) => {
    const props = {
        open: true,
        onClose: () => undefined,
        slug: "linear",
        connectionName: "Linear",
        toolPrefix: "linear_",
        policy: {permission: "allow"} as McpServerPolicy,
        onChange: vi.fn(),
        ...extra,
    }
    await act(async () => {
        root.render(createElement(McpPermissionDrawer, props))
    })
    return props.onChange
}

const text = () => document.body.textContent ?? ""

const labelled = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

const click = async (element: Element | undefined | null) => {
    expect(element).toBeTruthy()
    await act(async () => (element as HTMLElement).click())
}

/** Open a Radix select the way the keyboard does, then pick the option whose label starts here. */
const choose = async (trigger: Element | null, option: string) => {
    expect(trigger).toBeTruthy()
    await act(async () =>
        trigger!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
    )
    await click(
        [...document.querySelectorAll('[role="option"]')].find((node) =>
            node.textContent?.startsWith(option),
        ),
    )
}

const openMenu = async (trigger: Element | null) => {
    expect(trigger).toBeTruthy()
    await act(async () =>
        trigger!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true})),
    )
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = () => false
    listMcpTools.mockResolvedValue(LINEAR_TOOLS)
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

describe("D1 — the drawer at its default", () => {
    it("says which server, under which prefix, and whether its login still works", async () => {
        await render()

        expect(text()).toContain("Linear")
        // The prefix, not the slug: this is the spelling the model sees on the server's tools, and
        // it is frozen at the time the server was added.
        expect(text()).toContain("linear_")
        expect(text()).toContain("Connected")
    })

    it("names the default permission and reads the saved one back as its preset", async () => {
        await render()

        expect(text()).toContain("Default permission")
        expect(labelled("Default permission")?.textContent).toContain("Allow all")
    })

    it("counts the whole catalog in the search placeholder", async () => {
        await render()

        expect(
            document.querySelector<HTMLInputElement>('input[aria-label="Search tools"]')
                ?.placeholder,
        ).toBe("Search 8 tools")
    })

    it("splits the tools into the two groups the server's own annotation decides", async () => {
        await render()

        expect(text()).toContain("Read-only · 4")
        expect(text()).toContain("Write · 4")
    })

    it("summarises each group by what its tools are set to", async () => {
        await render()

        // Every tool follows an `allow` server, so both groups run without asking.
        expect(text()).toContain("runs automatically")
    })

    it("shows the server's title for a tool rather than its raw name", async () => {
        await render()

        expect(text()).toContain("Get Linear issue")
        expect(text()).not.toContain("get_issue ")
    })

    it("offers a way out of the agent and a way out of the drawer", async () => {
        await render({onRemove: vi.fn()})

        expect(button("Remove from agent")).toBeDefined()
        expect(button("Done")).toBeDefined()
    })

    it("writes nothing when Done is pressed, because every change already wrote", async () => {
        // There is no dirty state and no save. Done and the close X do the same thing, so a person
        // who closes the drawer without pressing Done does not lose what they set.
        const onChange = await render()

        await click(button("Done"))

        expect(onChange).not.toHaveBeenCalled()
    })
})

describe("D2 — the preset menu", () => {
    it("holds the five presets, each with the line that says what it does", async () => {
        await render()

        await openMenu(labelled("Default permission"))
        const menu = [...document.querySelectorAll('[role="option"]')]
            .map((node) => node.textContent ?? "")
            .join("|")

        expect(menu).toContain("Always ask")
        expect(menu).toContain("Approval before every run")
        expect(menu).toContain("Ask for write and delete")
        expect(menu).toContain("Read-only tools run automatically")
        expect(menu).toContain("Allow all")
        expect(menu).toContain("Everything runs without asking")
        expect(menu).toContain("Deny all")
        expect(menu).toContain("Tools stay listed but never run")
        expect(menu).toContain("Custom")
    })

    it("shows Custom but refuses to let anyone pick it", async () => {
        // Custom is what a non-empty per-tool table READS BACK as. It has no default of its own to
        // write, so offering it as a choice would be offering a no-op.
        await render()

        await openMenu(labelled("Default permission"))
        const custom = [...document.querySelectorAll('[role="option"]')].find((node) =>
            node.textContent?.startsWith("Custom"),
        )

        expect(custom?.getAttribute("aria-disabled")).toBe("true")
    })

    it("clears every per-tool override when a preset is picked", async () => {
        const onChange = await render({
            policy: {permission: "allow", tool_permissions: {delete_issue: "deny"}},
        })

        await choose(labelled("Default permission"), "Deny all")

        expect(onChange).toHaveBeenCalledWith({permission: "deny"})
    })
})

describe("D3 — one tool overridden", () => {
    const custom: McpServerPolicy = {
        permission: "allow",
        tool_permissions: {delete_issue: "deny"},
    }

    it("reads the preset back as Custom, with the number of rules behind it", async () => {
        await render({policy: custom})

        expect(labelled("Default permission")?.textContent).toContain("Custom · 1 override")
    })

    it("turns the affected group's summary to mixed and leaves the other alone", async () => {
        await render({policy: custom})

        expect(text()).toContain("mixed")
        // The read-only group is untouched, so it still says what all four of its tools do.
        expect(text()).toContain("runs automatically")
    })

    it("writes an entry for the tool that was set", async () => {
        const onChange = await render({policy: {permission: "allow"}})

        await choose(labelled("Permission for delete_issue"), "Deny")

        expect(onChange).toHaveBeenCalledWith({
            permission: "allow",
            tool_permissions: {delete_issue: "deny"},
        })
    })

    it("keeps a rule for a tool the server stopped offering, as an editable row", async () => {
        // A server can stop advertising a tool temporarily. Dropping the rule would hide the
        // author's decision and re-admit the tool under the default when it came back.
        await render({policy: {permission: "allow", tool_permissions: {retired_tool: "deny"}}})

        expect(text()).toContain("not in catalog")
        expect(labelled("Permission for retired_tool")?.getAttribute("disabled")).toBeNull()
    })
})

describe("D4 — the login has lapsed", () => {
    const expired = {connectionState: "needs_auth" as const, connectionName: "Octolens"}

    it("says so in the header rather than claiming the server is connected", async () => {
        await render(expired)

        expect(text()).toContain("Login expired")
        expect(text()).not.toContain("Connected")
    })

    it("explains what stops working, what is kept, and who can fix it", async () => {
        await render({...expired, onReconnect: vi.fn()})

        expect(text()).toContain("Octolens needs a new sign-in.")
        expect(text()).toContain(
            "Its tools fail until someone in the project reconnects. Permissions below are kept.",
        )
        expect(button("Reconnect")).toBeDefined()
    })

    it("makes the controls below inert, not merely faint", async () => {
        // Dimmed and still clickable is the worse of both: it reads as unavailable and behaves as
        // available, so an author sets a permission that the expired login makes meaningless.
        await render(expired)

        expect(labelled("Default permission")?.getAttribute("disabled")).not.toBeNull()
        expect(
            document
                .querySelector<HTMLInputElement>('input[aria-label="Search tools"]')
                ?.getAttribute("disabled"),
        ).not.toBeNull()
    })

    it("counts the tools from the record, because the list itself cannot be read", async () => {
        listMcpTools.mockRejectedValue(new Error("no"))
        await render({...expired, cachedToolCount: 12})

        expect(
            document.querySelector<HTMLInputElement>('input[aria-label="Search tools"]')
                ?.placeholder,
        ).toBe("Search 12 tools")
    })

    it("asks for the sign-in once, not twice in two different wordings", async () => {
        listMcpTools.mockRejectedValue(new Error("no"))
        await render({...expired, onReconnect: vi.fn()})

        expect(button("Connect")).toBeUndefined()
        expect(button("Retry tools")).toBeUndefined()
    })
})

describe("View tools — the same drawer with nothing to set", () => {
    it("lists the tools and their groups", async () => {
        await render({readOnly: true})

        expect(text()).toContain("Read-only · 4")
        expect(text()).toContain("Get Linear issue")
    })

    it("carries the count in the header, since there is no preset to read it from", async () => {
        await render({readOnly: true})

        expect(text()).toContain("8 tools")
    })

    it("offers no control that would write to an agent this view does not own", async () => {
        await render({readOnly: true, onRemove: vi.fn()})

        expect(labelled("Permission for get_issue")).toBeNull()
        expect(labelled("Default permission")).toBeNull()
        expect(button("Remove from agent")).toBeUndefined()
        expect(button("Done")).toBeUndefined()
    })
})

describe("removing the server from this agent", () => {
    it("asks first, and says what removal does not do", async () => {
        // "Remove from agent" and "Disconnect" are one keystroke apart in consequence: one detaches
        // the server from this agent, the other takes it out of the project for everybody.
        await render({onRemove: vi.fn()})

        await click(button("Remove from agent"))

        expect(text()).toContain(
            "Remove Linear from this agent? The connection stays in the project.",
        )
        expect(button("Remove")).toBeDefined()
        expect(button("Cancel")).toBeDefined()
    })

    it("does nothing until the confirm is taken", async () => {
        const onRemove = vi.fn()
        await render({onRemove})

        await click(button("Remove from agent"))

        expect(onRemove).not.toHaveBeenCalled()
    })

    it("takes the confirm back on Cancel", async () => {
        const onRemove = vi.fn()
        await render({onRemove})

        await click(button("Remove from agent"))
        await click(button("Cancel"))

        expect(text()).not.toContain("The connection stays in the project.")
        expect(onRemove).not.toHaveBeenCalled()
    })

    it("removes it on Remove", async () => {
        const onRemove = vi.fn()
        await render({onRemove})

        await click(button("Remove from agent"))
        await click(button("Remove"))

        expect(onRemove).toHaveBeenCalled()
    })

    it("is not offered at all when the caller has nowhere to remove from", async () => {
        await render()

        expect(button("Remove from agent")).toBeUndefined()
    })
})

describe("while the tool list is being read", () => {
    it("holds the shape of the list rather than an empty frame", async () => {
        let release: (tools: unknown) => void = () => undefined
        listMcpTools.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )

        await render()

        // Three placeholder rows, so the list area keeps its shape while the answer is on the way.
        // An empty frame here reads as a server with no tools, which is a different answer.
        expect(document.querySelectorAll('[data-slot="skeleton-block"]')).toHaveLength(3)
        expect(text()).not.toContain("This server exposes no tools yet.")

        release(LINEAR_TOOLS)
        await act(async () => {
            await Promise.resolve()
        })
    })
})
