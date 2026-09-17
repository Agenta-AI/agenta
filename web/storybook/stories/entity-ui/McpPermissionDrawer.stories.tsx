import {useEffect, useState} from "react"

import {
    McpProtocolError,
    type McpServerPolicy,
    type McpToolSummary,
} from "@agenta/entities/mcpEndpoint"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the mcpEndpoint barrel re-exports it, but the sibling drawers here are
// imported from source too and mixing the two makes the deep-link paths inconsistent.
import McpPermissionDrawer from "../../../packages/agenta-entity-ui/src/mcpEndpoint/McpPermissionDrawer"

/**
 * **What one agent may do with one MCP server.** The same drawer the Integrations permission editor
 * uses, fed an MCP connection: the header carries the server tile, the connection name, the frozen
 * tool prefix and the connection's health, and the body carries the preset, the search and the two
 * groups the server's own `readOnlyHint` annotation decides.
 *
 * It shows what is SAVED and never resolves a permission. On this wire the absence of a value IS
 * the fourth value: no `permission` on the server means it follows the agent's policy, and a tool
 * with no entry in `tool_permissions` carries no rule of its own. That is why a row with no rule
 * reads "Inherits ask" rather than borrowing the server's word for it, and why this source's preset
 * menu has a sixth entry the Integrations one does not.
 */
const meta = {
    title: "@agenta/entity-ui/MCP/McpPermissionDrawer",
    component: McpPermissionDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "One MCP connection's permission policy inside an agent: a preset select, a " +
                    "tool search, two collapsible groups with per-tool selects, a login-expired " +
                    "banner, and a footer that detaches the server from this agent only.",
            },
        },
    },
} satisfies Meta<typeof McpPermissionDrawer>

export default meta
type Story = StoryObj

const noop = () => undefined

/** The nine tools the design board's own data block supplies. */
const LINEAR_TOOLS: McpToolSummary[] = [
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
        name: "get_project",
        title: "Get Linear project",
        description: "Retrieves a single project by its unique identifier.",
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

const listTools = async () => LINEAR_TOOLS

/** A request that never settles, for the placeholder state. */
const neverSettles = () => new Promise<McpToolSummary[]>(() => undefined)

/** The shape the tool-list client really throws; an axios-shaped stub never reaches the drawer. */
const refuseWithoutAuth = async (): Promise<McpToolSummary[]> => {
    throw new McpProtocolError("Authorization required for custom/linear", "auth_required")
}

/**
 * Opens a select after the drawer has mounted, so the menu screens render without a person having
 * to click. Story-only: the product's menus open from the keyboard and the pointer.
 */
function AutoOpen({label}: {label: string}) {
    useEffect(() => {
        const timer = window.setTimeout(() => {
            document
                .querySelector(`[aria-label="${label}"]`)
                ?.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}))
        }, 150)
        return () => window.clearTimeout(timer)
    }, [label])
    return null
}

// The drawer is a controlled overlay, so the story owns `open`, with a re-open button so it stays
// usable after a close. Same host pattern as the other prop-driven drawers here.
function DrawerHost({
    policy,
    autoOpen,
    ...props
}: Partial<Parameters<typeof McpPermissionDrawer>[0]> & {
    policy: McpServerPolicy
    autoOpen?: string
}) {
    const [open, setOpen] = useState(true)
    const [live, setLive] = useState(policy)

    return (
        <div data-vrt-subject className="min-h-[640px]">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Open permissions
            </Button>
            <McpPermissionDrawer
                open={open}
                onClose={() => setOpen(false)}
                slug="linear"
                connectionName="Linear"
                toolPrefix="linear_"
                loadTools={listTools}
                policy={live}
                onChange={setLive}
                {...props}
            />
            {open && autoOpen ? <AutoOpen label={autoOpen} /> : null}
        </div>
    )
}

/**
 * D1, as the board draws it: `allow` at the server level and no overrides. Both groups summarise as
 * "runs automatically", and every row says it inherits that rather than claiming a rule of its own.
 *
 * This is a state an author reaches by picking "Allow all", not the state a server is added in. See
 * `JustAdded`.
 */
export const AllowAll: Story = {
    render: () => <DrawerHost policy={{permission: "allow"}} onRemove={noop} />,
}

/**
 * The shape "Ask for write and delete" writes, which is what its help line describes: the server
 * asks, every tool the server's own `readOnlyHint` marks read-only is allowed BY NAME, and anything
 * the table does not name asks. Read-only summarises as "runs automatically" and write as "asks
 * first", which is the promise, visible.
 *
 * It wrote nothing at all before decision 45, so it was indistinguishable from `JustAdded` and its
 * words described behaviour the wire did not carry.
 */
export const AskForWriteAndDelete: Story = {
    render: () => (
        <DrawerHost
            policy={{
                permission: "ask",
                tool_permissions: {
                    get_current_user: "allow",
                    get_issue: "allow",
                    list_issues: "allow",
                    list_comments: "allow",
                    get_project: "allow",
                },
                new_tool_permission: "ask",
            }}
            onRemove={noop}
        />
    ),
}

/**
 * D2. The presets, each with the line that says what it does. This source has six: the spec's five
 * plus "Follow agent policy", the one whose saved value is the absence of a policy (decision 45).
 * "Custom" sits under a divider and is shown but not pickable: it is what a non-empty per-tool
 * table READS BACK as, and it has no default of its own to write.
 */
export const PresetMenuOpen: Story = {
    render: () => (
        <DrawerHost policy={{permission: "allow"}} onRemove={noop} autoOpen="Default permission" />
    ),
}

/**
 * D3's menu. Four values. "Follow agent policy" is the absence of an entry, so picking it clears
 * the row's rule rather than writing a fourth value the MCP wire cannot carry.
 */
export const PerToolMenuOpen: Story = {
    render: () => (
        <DrawerHost
            policy={{permission: "allow"}}
            onRemove={noop}
            autoOpen="Permission for delete_issue"
        />
    ),
}

/**
 * D3. Two tools overridden. The preset reads back as "Custom · 2 overrides" and the write group's
 * summary turns to "mixed". The count is the number of SAVED entries, including one that happens to
 * equal what governs the rest: an author who set a value deliberately gets to keep seeing it.
 *
 * Note what the untouched read-only rows now say. Declaring a per-tool table moves the governing
 * value from the server permission to the table's own floor, so a row nobody named reads
 * "Inherits allow" only because the floor was written at the value the rows were already showing.
 */
export const CustomWithOverrides: Story = {
    render: () => (
        <DrawerHost
            policy={{
                permission: "allow",
                tool_permissions: {delete_issue: "deny", update_issue: "ask"},
            }}
            onRemove={noop}
        />
    ),
}

/**
 * D4. The sign-in has lapsed. One banner, one action, and everything below it readable and inert:
 * dimmed but still clickable is the worse of both, because an author would set a permission the
 * expired login makes meaningless. The count comes from the connection record, because the list
 * itself cannot be read.
 */
export const LoginExpired: Story = {
    render: () => (
        <DrawerHost
            // No `permission` at all, which on this wire IS "follows agent policy", and reads
            // back as the preset of that name.
            policy={{}}
            connectionName="Octolens"
            toolPrefix="octolens_"
            status="login_expired"
            cachedToolCount={12}
            loadTools={refuseWithoutAuth}
            onReconnect={noop}
            onRemove={noop}
        />
    ),
}

/**
 * Settings' "View tools". The same drawer with nothing to set: the header carries the count, the
 * groups and rows have no selects, and there is no footer and no way to detach a server from an
 * agent this view does not own.
 */
export const ReadOnly: Story = {
    render: () => <DrawerHost policy={{permission: "allow"}} readOnly />,
}

/**
 * Two rules the catalog cannot honour, for opposite reasons.
 *
 * `retired_tool` is a rule for a tool the server stopped advertising. It stays as an editable row
 * marked "no longer offered", because a server can go quiet about a tool temporarily and dropping
 * the rule would re-admit it under the default when it came back.
 *
 * `delete_issue` is hidden by the server's own include filter, so it may not carry a permission at
 * all: the API refuses the whole policy, and the agent cannot run until the rule is gone. Its row
 * control is disabled, which is why the rule gets a Remove of its own below the list.
 */
export const StaleAndHiddenTools: Story = {
    render: () => (
        <DrawerHost
            policy={{
                permission: "allow",
                tools: {mode: "include", names: ["get_issue", "list_issues"]},
                tool_permissions: {retired_tool: "deny", delete_issue: "deny", get_issue: "allow"},
            }}
            onRemove={noop}
        />
    ),
}

/**
 * The tool list could not be read because nobody has authorized the server. It offers Connect
 * rather than Retry, because retrying an unauthorized server only fails again, and it names the
 * connection instead of the route and the refusal code the gateway sends.
 */
export const Unauthorized: Story = {
    render: () => (
        <DrawerHost
            policy={{permission: "allow"}}
            loadTools={refuseWithoutAuth}
            onReconnect={noop}
        />
    ),
}

/**
 * The state a server is actually added in: no permission written at all (decision 36).
 *
 * On this wire that is not "nothing set", it is "follows the agent's own permission ladder", so the
 * preset reads "Follow agent policy" and so does every row, with no provenance to add. It read back
 * as "Ask for write and delete" until decision 45, under a help line promising that read-only tools
 * run automatically, which nothing written does not do. Picking "Allow all" from here writes
 * `permission: "allow"` explicitly.
 */
export const JustAdded: Story = {
    render: () => <DrawerHost policy={{}} onRemove={noop} />,
}

/** Three placeholder rows, so the list area keeps its shape while the answer is on the way. */
export const Loading: Story = {
    render: () => <DrawerHost policy={{permission: "allow"}} loadTools={neverSettles} />,
}

/**
 * The drawer closed, which is its state on a rail that has not been opened. `destroyOnClose` means
 * no tool list is fetched and no policy is read until somebody asks for it.
 */
export const OpenState: Story = {
    render: function OpenStateStory() {
        const [open, setOpen] = useState(false)
        const [live, setLive] = useState<McpServerPolicy>({permission: "allow"})
        return (
            <div data-vrt-subject className="min-h-[200px]">
                <Button variant="outline" onClick={() => setOpen(true)}>
                    Open permissions
                </Button>
                <McpPermissionDrawer
                    open={open}
                    onClose={() => setOpen(false)}
                    slug="linear"
                    connectionName="Linear"
                    toolPrefix="linear_"
                    loadTools={listTools}
                    policy={live}
                    onChange={setLive}
                    onRemove={noop}
                />
            </div>
        )
    },
}
