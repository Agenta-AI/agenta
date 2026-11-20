import {useEffect} from "react"
import type React from "react"

import {
    McpAddServerList,
    type McpAddServerListProps,
    type McpConnectionOption,
} from "@agenta/entity-ui/mcpEndpoint"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The list an agent picks an MCP connection from. It replaced the connection select that
// used to sit inside the agent's MCP form, which could not show a login that had expired.
const meta = {
    title: "@agenta/entity-ui/McpEndpoint/McpAddServerList",
    component: McpAddServerList,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "Lists the project's MCP connections so one agent can pick among them. " +
                    "Add attaches the connection and opens the server view, Reconnect " +
                    "runs the auth step alone, and a connection already on this agent is " +
                    "inert. An empty project is a different screen from an empty search.",
            },
        },
    },
} satisfies Meta<typeof McpAddServerList>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const OPTIONS: McpConnectionOption[] = [
    {
        slug: "linear",
        name: "Linear",
        host: "mcp.linear.app",
        status: "connected",
        added: true,
    },
    {slug: "axiom", name: "Axiom", host: "mcp.axiom.co", status: "connected"},
    {slug: "octolens", name: "Octolens", host: "mcp.octolens.com", status: "login_expired"},
    {slug: "sentry", name: "Sentry", host: "mcp.sentry.dev", status: "connected"},
]

// The width of the agent panel, where the list's view opens.
const Frame = (children: React.ReactNode) => (
    <div className="flex h-[640px] w-[440px] flex-col bg-[var(--ag-colorBgContainer)]">
        {children}
    </div>
)

const args = {
    onAdd: noop,
    onReconnect: noop,
    onConnectServer: noop,
}

/**
 * The list with text already in its search field. The field is the list's own state,
 * deliberately: nothing in the product needs to drive it, and a prop added only so a story
 * could set it would be API nobody calls. So the story types into it instead.
 */
function SearchedList({query, ...props}: McpAddServerListProps & {query: string}) {
    useEffect(() => {
        const field = document.querySelector<HTMLInputElement>('input[aria-label="Search servers"]')
        if (!field) return
        const setValue = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
        )?.set
        setValue?.call(field, query)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    }, [query])

    return <McpAddServerList {...props} />
}

/** The list as a working project sees it: one added, two to add, one to reconnect. */
export const Showcase: Story = {
    args: {...args, options: OPTIONS},
    render: (a) => Frame(<McpAddServerList {...a} />),
}

/** The three row states side by side, which is the whole vocabulary of this list. */
export const AllRowStates: Story = {
    args: {...args, options: OPTIONS.slice(0, 3)},
    render: (a) => Frame(<McpAddServerList {...a} />),
}

/** B2. The header action is gone and the centred block carries the only one. */
export const EmptyProject: Story = {
    args: {...args, options: []},
    render: (a) => Frame(<McpAddServerList {...a} />),
}

/**
 * A search that matches nothing. Deliberately not the empty-project screen: the header
 * action stays, because the project does have servers and the reader typed past them.
 */
export const NoSearchResults: Story = {
    args: {...args, options: OPTIONS},
    render: (a) => Frame(<SearchedList {...a} query="grafana" />),
}

/** Decision 25: three skeleton rows while the project registry is in flight. */
export const Loading: Story = {
    args: {...args, options: [], loading: true},
    render: (a) => Frame(<McpAddServerList {...a} />),
}

/** The list at full height, for the visual comparison harness. */
export const OpenState: Story = {
    args: {...args, options: OPTIONS},
    render: (a) => Frame(<McpAddServerList {...a} />),
}
