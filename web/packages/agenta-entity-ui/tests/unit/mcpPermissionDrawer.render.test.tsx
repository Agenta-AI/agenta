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
import {
    getMcpConnectionStatus,
    readMcpPolicy,
    type McpServerPolicy,
} from "@agenta/entities/mcpEndpoint"
import {buildMcpAgentItem} from "../../src/DrillInView/SchemaControls/agentTemplate/mcpRail"

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

/** Type into the search field the way a person does: React reads the native value setter. */
const search = async (value: string) => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search tools"]')
    expect(input).toBeTruthy()
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
        setValue?.call(input, value)
        input!.dispatchEvent(new Event("input", {bubbles: true}))
    })
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

    it("leads the header with the generic server tile, since an MCP endpoint has no branding", async () => {
        // One plugs glyph on the info tile for every server (decision 3). A per-server logo would
        // have to be guessed from a URL, and a header with nothing in that slot reads as a row
        // that failed to load an icon.
        await render()

        const tile = document.querySelector('[data-slot="icon-tile"]')
        expect(tile?.getAttribute("data-tone")).toBe("info")
        expect(tile?.getAttribute("data-size")).toBe("24")
        expect(tile?.querySelector("svg")).not.toBeNull()
    })

    it("is a bottom sheet on a phone and a right-edge drawer above the breakpoint", async () => {
        // The one prop that makes a configuration panel correct in both apps. A desktop drawer
        // squeezed onto a phone is the failure this replaces; the geometry itself is measured in a
        // browser, so what this pins is that the drawer asks for the responsive side at all.
        await render()

        const panel = document.querySelector('[role="dialog"]')
        expect(panel?.className).toContain("bottom-0")
        expect(panel?.className).toContain("lg:right-0")
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

    it("counts one tool in the singular", async () => {
        // "Search 1 tools" was on screen for any server advertising a single tool. The same noun
        // count is spelled once now, in the shared `formatCount`.
        listMcpTools.mockResolvedValue([LINEAR_TOOLS[0]])
        await render()

        expect(
            document.querySelector<HTMLInputElement>('input[aria-label="Search tools"]')
                ?.placeholder,
        ).toBe("Search 1 tool")
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

describe("a server just added to an agent", () => {
    // Adding writes no server permission (decision 36), and on this wire that is not "nothing
    // set": it means the run's own permission ladder decides. The drawer has to render it as the
    // preset that saves that absence rather than as a value nobody chose.
    //
    // The exact shape the add path writes, taken from `buildMcpAgentItem` rather than written
    // out here, so the two packages cannot drift: a filter admitting everything, and no
    // permission, no floor and no table. If adding ever starts writing one, these four cases
    // fail rather than the drawer quietly showing a preset nobody picked.
    const justAdded = readMcpPolicy(buildMcpAgentItem({slug: "linear", name: "Linear"}))

    it("carries no permission, no floor and no per-tool table", async () => {
        expect(justAdded.permission).toBeUndefined()
        expect(justAdded.new_tool_permission).toBeUndefined()
        expect(justAdded.tool_permissions).toBeUndefined()
    })

    it("reads back as the preset named for the absence, not as one that promises behaviour", async () => {
        // It used to read back as "Ask for write and delete", whose help line says read-only tools
        // run automatically. Nothing written carries no such promise: the run's own ladder decides
        // every tool. That preset writes a shape of its own now, and the absence has its own name
        // (decision 45).
        await render({policy: justAdded})

        expect(labelled("Default permission")?.textContent).toContain("Follow agent policy")
        expect(labelled("Default permission")?.textContent).not.toContain(
            "Ask for write and delete",
        )
        expect(labelled("Default permission")?.textContent).not.toContain("Allow all")
        expect(labelled("Default permission")?.textContent).not.toContain("Custom")
    })

    it("says every row follows the agent policy, with no provenance to add", async () => {
        // There is no governing value to name here, so the row says which value it holds rather
        // than "Inherits" something the policy does not state.
        await render({policy: justAdded})

        expect(labelled("Permission for get_issue")?.textContent).toContain("Follow agent policy")
        expect(labelled("Permission for get_issue")?.textContent).not.toContain("Inherits")
    })

    it("summarises both groups as following the agent policy", async () => {
        await render({policy: justAdded})

        expect(text()).toContain("follows agent policy")
    })

    it("writes the permission explicitly when Allow all is picked from there", async () => {
        const onChange = await render({policy: justAdded})

        await choose(labelled("Default permission"), "Allow all")

        // The permission is written, and the tool filter the add path wrote survives untouched:
        // it decides what the server ADVERTISES, not what the agent may run, and dropping it on a
        // preset pick would quietly widen a filtered server.
        expect(onChange).toHaveBeenCalledWith({
            tools: {mode: "all"},
            permission: "allow",
        })
    })
})

describe("a search that names none of this server's tools", () => {
    it("says so, rather than emptying the list under its own headers", async () => {
        // Two groups still headed "Read-only · 4" and "Write · 4" with nothing under them read as
        // a server that stopped advertising its tools, which is a different answer. The sentence
        // is the connection detail drawer's, so one filter's emptiness reads the same everywhere.
        await render()

        await search("nothing here matches this")

        expect(text()).toContain("No tool here matches that.")
        expect(text()).not.toContain("Read-only · 4")
        expect(text()).not.toContain("Write · 4")
    })

    it("does not say the server has no tools, which is a different answer", async () => {
        await render()

        await search("zzz")

        expect(text()).not.toContain("This server exposes no tools yet.")
    })

    it("brings the groups back when the query matches again", async () => {
        await render()

        await search("zzz")
        await search("issue")

        expect(text()).not.toContain("No tool here matches that.")
        expect(text()).toContain("Get Linear issue")
    })

    it("counts a match on the description, not only on the name", async () => {
        // The rule the groups filter by and the rule that decides this message are one rule.
        await render()

        await search("cannot be undone")

        expect(text()).not.toContain("No tool here matches that.")
        expect(text()).toContain("Delete issue")
    })
})

describe("D2 — the preset menu", () => {
    it("holds the presets, each with the line that says what it does", async () => {
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
        // The sixth, which only this source has: the preset whose saved value is the absence of a
        // policy. Its help line states the one fact the absence carries, in the words the group
        // rollups already use for it.
        expect(menu).toContain("Follow agent policy")
        expect(menu).toContain("Follows agent policy for every tool")
        // The spec's own sentence for Custom, which the preset table already carries. The menu had
        // written its own, "Set below, per tool", so the one preset an author cannot pick was also
        // the one described in words the spec never uses.
        expect(menu).toContain("Per-tool permissions below")
        expect(menu).not.toContain("Set below, per tool")
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

describe("a policy whose per-tool table arrives under the runner's field names", () => {
    // The runner spells this table `toolPermissions` / `newToolPermission`; the wire and every
    // reader on this side spell it `tool_permissions` / `new_tool_permission`. A policy carrying
    // the runner's spelling is a table this side cannot read, and the readers in `@agenta/entities`
    // refuse it rather than guessing.
    //
    // Nothing in THIS package held them to that: with the refusal removed, every case here stayed
    // green, so the drawer's protection was borrowed from another package's suite. A table read
    // through the wrong spelling would put "Allow" on rows nobody set, on names that are not even
    // in this server's catalog.
    //
    // The two entries are the runner's own, from `mcp-permission-intake.test.ts`.
    const foreignSpelling = {
        permission: "ask",
        toolPermissions: {search: "allow", purge: "deny"},
        newToolPermission: "allow",
    } as unknown as McpServerPolicy

    it("reads the whole-server permission, because there is no table it can read", async () => {
        await render({policy: foreignSpelling})

        expect(labelled("Default permission")?.textContent).toContain("Always ask")
        expect(labelled("Default permission")?.textContent).not.toContain("Custom")
        expect(labelled("Default permission")?.textContent).not.toContain("Allow all")
    })

    it("gives every row the value it inherits, and no tool an allow", async () => {
        await render({policy: foreignSpelling})

        for (const tool of [
            "get_current_user",
            "get_issue",
            "list_issues",
            "list_comments",
            "create_issue",
            "update_issue",
            "create_comment",
            "delete_issue",
        ]) {
            const row = labelled(`Permission for ${tool}`)
            expect(row?.textContent).toContain("Inherits ask")
            expect(row?.textContent).not.toContain("Allow")
        }
    })

    it("draws no row for the names only the unreadable table holds", async () => {
        // A name this side cannot read is not a rule it can show, and showing one would offer a
        // control that writes under the spelling the runner does not read.
        await render({policy: foreignSpelling})

        expect(labelled("Permission for search")).toBeNull()
        expect(labelled("Permission for purge")).toBeNull()
        expect(text()).not.toContain("no longer offered")
    })

    it("summarises both groups as asking first, never as running automatically", async () => {
        await render({policy: foreignSpelling})

        expect(text()).toContain("asks first")
        expect(text()).not.toContain("runs automatically")
        expect(text()).not.toContain("mixed")
    })
})

describe("the preset that follows the agent's policy names it", () => {
    // Its whole meaning is "the agent's own permission policy decides", and the drawer already
    // carries the sentence that says which policy that is. The MCP drawer's `agentPolicy` prop was
    // removed alongside decision 45, so a person picked the preset and was sent to a different row
    // to find out whether the ladder asks, allows or denies. The sentence is the Integrations one,
    // pointed at this source's own preset.
    it("says which policy it follows when the agent is not on its default", async () => {
        await render({policy: {}, agentPolicy: "deny"})

        expect(labelled("Default permission")?.textContent).toContain("Follow agent policy")
        expect(text()).toContain(
            "This agent's permission policy is set to deny all, so these tools follow it.",
        )
    })

    it("says nothing when the agent is on its default, which the sentence has no news about", async () => {
        await render({policy: {}, agentPolicy: "allow_reads"})

        expect(text()).not.toContain("This agent's permission policy is set to")
    })

    it("does not qualify the preset that writes what it says", async () => {
        // "Ask for write and delete" no longer leans on the ladder, so naming the ladder under it
        // would describe something that does not decide anything here (decision 45).
        await render({
            policy: {
                permission: "ask",
                tool_permissions: {
                    get_current_user: "allow",
                    get_issue: "allow",
                    list_issues: "allow",
                    list_comments: "allow",
                },
                new_tool_permission: "ask",
            } as McpServerPolicy,
            agentPolicy: "deny",
        })

        expect(labelled("Default permission")?.textContent).toContain("Ask for write and delete")
        expect(text()).not.toContain("This agent's permission policy is set to")
    })

    it("says nothing on a preset that decides for itself", async () => {
        await render({policy: {permission: "allow"}, agentPolicy: "deny"})

        expect(text()).not.toContain("This agent's permission policy is set to")
    })
})

describe("Ask for write and delete — the preset that writes what it says", () => {
    // Its help line promises that read-only tools run automatically and everything else asks.
    // Nothing on this wire says that on its own, so the preset spells it out: ask at the server,
    // every read-only tool allowed by name, ask for anything the table does not name. It used to
    // write nothing at all, which is the absent policy, under that same help line (decision 45).
    const READ_ONLY = {
        get_current_user: "allow",
        get_issue: "allow",
        list_issues: "allow",
        list_comments: "allow",
    }

    it("names every read-only tool the server advertises", async () => {
        const onChange = await render({policy: {permission: "allow"}})

        await choose(labelled("Default permission"), "Ask for write and delete")

        expect(onChange).toHaveBeenCalledWith({
            permission: "ask",
            tool_permissions: READ_ONLY,
            new_tool_permission: "ask",
        })
    })

    it("writes something other than the shape a newly added server carries", async () => {
        const onChange = await render({policy: {permission: "allow"}})

        await choose(labelled("Default permission"), "Ask for write and delete")

        expect(onChange.mock.calls[0][0]).not.toEqual({})
    })

    it("reads back as itself from that shape", async () => {
        await render({
            policy: {
                permission: "ask",
                tool_permissions: READ_ONLY,
                new_tool_permission: "ask",
            } as McpServerPolicy,
        })

        expect(labelled("Default permission")?.textContent).toContain("Ask for write and delete")
        expect(labelled("Default permission")?.textContent).not.toContain("Custom")
    })

    it("names only the read-only tools this server's filter admits", async () => {
        // The API refuses a whole policy that gives a permission to a tool the filter hides, so
        // naming one would leave an agent that cannot run at all.
        const onChange = await render({
            policy: {
                permission: "allow",
                tools: {mode: "include", names: ["get_issue", "create_issue"]},
            } as McpServerPolicy,
        })

        await choose(labelled("Default permission"), "Ask for write and delete")

        expect(onChange).toHaveBeenCalledWith({
            tools: {mode: "include", names: ["get_issue", "create_issue"]},
            permission: "ask",
            tool_permissions: {get_issue: "allow"},
            new_tool_permission: "ask",
        })
    })

    it("shows the grant on the rows it just named, not an inherited value", async () => {
        // The preset's whole claim is per tool, so the rows have to carry it: a read-only row
        // still reading "Inherits ask" after the pick would say the opposite of what was picked.
        const onChange = await render({policy: {permission: "allow"}})

        await choose(labelled("Default permission"), "Ask for write and delete")
        await render({policy: onChange.mock.calls[0][0] as McpServerPolicy})

        for (const tool of ["get_current_user", "get_issue", "list_issues", "list_comments"]) {
            expect(labelled(`Permission for ${tool}`)?.textContent).toContain("Allow")
            expect(labelled(`Permission for ${tool}`)?.textContent).not.toContain("Inherits")
        }
    })

    it("leaves the write rows inheriting the ask the preset wrote as the floor", async () => {
        const onChange = await render({policy: {permission: "allow"}})

        await choose(labelled("Default permission"), "Ask for write and delete")
        await render({policy: onChange.mock.calls[0][0] as McpServerPolicy})

        for (const tool of ["create_issue", "delete_issue"]) {
            expect(labelled(`Permission for ${tool}`)?.textContent).toContain("Inherits ask")
        }
    })

    it("summarises the reads as running automatically and the writes as asking", async () => {
        const onChange = await render({policy: {permission: "allow"}})

        await choose(labelled("Default permission"), "Ask for write and delete")
        await render({policy: onChange.mock.calls[0][0] as McpServerPolicy})

        // The promise, visible in the two group headers.
        expect(text()).toContain("runs automatically")
        expect(text()).toContain("asks first")
        expect(text()).not.toContain("mixed")
    })

    it("names no preset while the list is on its way, for a policy shaped like this one", async () => {
        // The adversarial policy: the three fields this preset writes, allowing the one tool that
        // deletes things. The select read "Ask for write and delete" from that shape alone, so
        // until the rows arrived it told a reader that this server's read-only tools run
        // automatically. It shows the list area's own loading bar instead now.
        listMcpTools.mockImplementation(() => new Promise(() => undefined))
        await render({
            policy: {
                permission: "ask",
                tool_permissions: {delete_issue: "allow"},
                new_tool_permission: "ask",
            } as McpServerPolicy,
        })

        expect(labelled("Default permission")).toBeNull()
        expect(text()).not.toContain("Ask for write and delete")
        // The label stays, so the row keeps its meaning while the control is pending.
        expect(text()).toContain("Default permission")
    })

    it("says Custom for that policy once the list has settled it", async () => {
        await render({
            policy: {
                permission: "ask",
                tool_permissions: {delete_issue: "allow"},
                new_tool_permission: "ask",
            } as McpServerPolicy,
        })

        expect(labelled("Default permission")?.textContent).toContain("Custom · 1 override")
        expect(labelled("Default permission")?.textContent).not.toContain(
            "Ask for write and delete",
        )
    })

    it("names no preset for its own policy while the list is on its way either", async () => {
        listMcpTools.mockImplementation(() => new Promise(() => undefined))
        await render({
            policy: {
                permission: "ask",
                tool_permissions: {get_issue: "allow"},
                new_tool_permission: "ask",
            } as McpServerPolicy,
        })

        expect(labelled("Default permission")).toBeNull()
    })

    it("draws a preset for every other policy while the list is on its way", async () => {
        // Pending must not stand in for an answer the drawer could give. Nothing about an absent
        // policy depends on which tools a server calls read-only.
        listMcpTools.mockImplementation(() => new Promise(() => undefined))
        await render({policy: {}})

        expect(labelled("Default permission")?.textContent).toContain("Follow agent policy")
    })

    it("is not offered until the tool list has arrived", async () => {
        // Picking it without the list would write no tool names at all, which is the absent policy
        // wearing this preset's words. The list area beside it is showing its own loading rows.
        listMcpTools.mockImplementation(() => new Promise(() => undefined))
        await render()

        await openMenu(labelled("Default permission"))
        const option = [...document.querySelectorAll('[role="option"]')].find((node) =>
            node.textContent?.startsWith("Ask for write and delete"),
        )

        expect(option?.getAttribute("aria-disabled")).toBe("true")
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

    it("takes the preset the person picked rather than snapping back to Allow all", async () => {
        // What decision 38 leaves after one override on an Allow all server: the floor sits beside
        // the server permission. Picking the preset whose saved value is the absence used to clear
        // the floor alone and return, handing the governing slot back to `allow`, so the select
        // read "Allow all" and every tool still ran unapproved after a pick that asked for the
        // opposite (decision 42). mcpPolicyAdapter.test.ts walks the same three steps at the
        // adapter. The pick is "Follow agent policy" now, which is the preset that saves the
        // absence since decision 45.
        const afterOverride: McpServerPolicy = {
            permission: "allow",
            tool_permissions: {delete_issue: "deny"},
            new_tool_permission: "allow",
        }
        const onChange = await render({policy: afterOverride})

        await choose(labelled("Default permission"), "Follow agent policy")

        expect(onChange).toHaveBeenCalledWith({})

        await render({policy: onChange.mock.calls[0][0] as McpServerPolicy})

        expect(labelled("Default permission")?.textContent).toContain("Follow agent policy")
        expect(labelled("Default permission")?.textContent).not.toContain("Allow all")
    })

    it("turns the affected group's summary to mixed and the untouched one to the floor", async () => {
        await render({policy: custom})

        expect(text()).toContain("mixed")
        // Not "runs automatically". Declaring a per-tool table moves the governing value from the
        // server permission to the table's own floor, and the floor is `ask` until somebody sets
        // one, so the four read-only tools nobody named now ask first. Saying "runs
        // automatically" here would promise an unapproved run the runner will not perform (D88).
        expect(text()).toContain("asks first")
    })

    it("writes an entry for the tool that was set", async () => {
        const onChange = await render({policy: {permission: "allow"}})

        await choose(labelled("Permission for delete_issue"), "Deny")

        // The floor is written alongside the entry, at the value the rows were already showing.
        // Without it, declaring a table would silently move every other tool from allow to the
        // `ask` floor, which is not what the author did and not what the screen said.
        expect(onChange).toHaveBeenCalledWith({
            permission: "allow",
            tool_permissions: {delete_issue: "deny"},
            new_tool_permission: "allow",
        })
    })

    it("keeps a rule for a tool the server stopped offering, as an editable row", async () => {
        // A server can stop advertising a tool temporarily. Dropping the rule would hide the
        // author's decision and re-admit the tool under the default when it came back.
        await render({policy: {permission: "allow", tool_permissions: {retired_tool: "deny"}}})

        // The spec's own phrase. "Not in catalog" is the Composio drawer's, and an MCP server has
        // no catalog: it advertises a tool list, and this one has stopped advertising this tool.
        expect(text()).toContain("no longer offered")
        expect(text()).not.toContain("not in catalog")
        expect(labelled("Permission for retired_tool")?.getAttribute("disabled")).toBeNull()
    })
})

describe("D4 — the login has lapsed", () => {
    // "login_expired" is the only failure status the release ships, and a key-authenticated
    // connection whose credential stopped working reports it too (decision 34), so one connection
    // reads the same word in the registry table and here.
    const expired = {
        status: "login_expired" as const,
        connectionName: "Octolens",
        toolPrefix: "octolens_",
    }

    it("says so in the header rather than claiming the server is connected", async () => {
        await render(expired)

        expect(text()).toContain("Login expired")
        expect(text()).not.toContain("Connected")
    })

    it("says the same thing for a key connection whose credential stopped working", async () => {
        // Driven through the derivation a caller really uses, not through a literal, because the
        // thing under test is that a key connection and a revoked grant reach the same word. An
        // OAuth grant that was revoked and an API key the server started refusing are the same
        // sentence to the person and differ only in which reconnect path the row offers. Two words
        // for one state is what the shared vocabulary exists to prevent (decision 34).
        const keyConnection = {auth_mode: "key"} as Parameters<typeof getMcpConnectionStatus>[0]

        await render({...expired, status: getMcpConnectionStatus(keyConnection)})

        expect(text()).toContain("Login expired")
        expect(text()).not.toContain("Needs input")
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

    it("carries one tool in the singular too", async () => {
        listMcpTools.mockResolvedValue([LINEAR_TOOLS[0]])
        await render({readOnly: true})

        expect(text()).toContain("1 tool")
        expect(text()).not.toContain("1 tools")
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

/**
 * A saved value that is not one of the three decisions, drawn (D172).
 *
 * The saved shape is JSON, so a table can carry another surface's spelling. Passed through, the
 * row's control had nothing to draw it as and rendered empty, which reads as a tool with no rule
 * while the saved policy says it has one. The value is dropped now, so the row shows the floor
 * the declared table sets and a person sees what the run will do.
 */
describe("a saved per-tool value the drawer cannot draw", () => {
    const misCasedValue = {
        permission: "allow",
        tool_permissions: {get_issue: "Allow"},
    } as unknown as McpServerPolicy

    it("draws the row as the floor the table sets rather than as nothing", async () => {
        await render({policy: misCasedValue})

        // The row's own control, not the page text: every other row reads the same floor, so a
        // page-wide check cannot tell an empty control from a filled one.
        const control = labelled("Permission for get_issue")
        expect(control?.textContent).toBeTruthy()
        // `Allow` is not a decision, so `get_issue` falls to the declared table's floor, and
        // the row says so the way every inheriting row does.
        expect(control?.textContent).toContain("Inherits ask")
    })

    it("does not let the server permission govern a table that was declared", async () => {
        await render({policy: misCasedValue})

        expect(labelled("Default permission")?.textContent).not.toContain("Allow all")
    })
})
