import {useEffect, useRef, type ReactNode} from "react"

import {McpServersSection} from "@agenta/settings-ui"
import {projectIdAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {AgentaDataParameters} from "../../.storybook/decorators/withAgentaData"

/**
 * The project's MCP registry, spec screens E1 and E2.
 *
 * Rows are seeded through the query cache rather than mocked at the component, so each story
 * exercises the same `getMcpConnectionState` derivation the product runs.
 */

interface Row {
    id: string
    slug: string
    name: string
    auth_mode: "oauth" | "api_key" | "none"
    secret_id: string | null
    flags?: {is_valid?: boolean}
    data: {route: {base_url: string}}
}

const row = (
    id: string,
    name: string,
    url: string,
    auth_mode: Row["auth_mode"],
    secret_id: string | null,
    flags?: {is_valid?: boolean},
): Row => ({id, slug: id, name, auth_mode, secret_id, flags, data: {route: {base_url: url}}})

const LINEAR = row("linear", "Linear", "https://mcp.linear.app/mcp", "oauth", "sec-linear")
const AXIOM = row("axiom", "Axiom", "https://mcp.axiom.co/mcp", "api_key", "sec-axiom")
const MEMORY = row("memory", "Memory", "https://memory.internal.acme.dev/mcp", "none", null)
const OCTOLENS = row("octolens", "Octolens", "https://app.octolens.com/api/mcp/v2", "oauth", null)
/** A stored key the server has stopped accepting: the other way into "Login expired". */
const STALE_KEY = row(
    "posthog",
    "PostHog",
    "https://mcp.posthog.com/mcp",
    "api_key",
    "sec-posthog",
    {is_valid: false},
)

/** The vault rows the Auth column resolves `secret_id` against. */
const SECRETS = [
    {id: "sec-linear", name: "linear_token", slug: "linear_token", type: "custom_secret"},
    {id: "sec-axiom", name: "axiom_token", slug: "axiom_token", type: "custom_secret"},
    {id: "sec-posthog", name: "posthog_key", slug: "posthog_key", type: "custom_secret"},
]

const fixture = (rows: Row[]): AgentaDataParameters => ({
    queries: (scope) => [
        [["mcp-endpoints", scope.projectId], rows],
        // `userAtom` is unseeded here, so the vault key carries an undefined user id.
        [["vault", "secrets", undefined, scope.projectId], SECRETS],
    ],
})

/**
 * The loading state, without a request.
 *
 * The endpoints query is gated on `enabled: !!projectId`, so clearing the project id holds it
 * pending forever instead of firing a fetch the story has no fixture for.
 */
const loadingFixture: AgentaDataParameters = {
    atoms: [[projectIdAtom, null]],
}

/**
 * Opens the first row's overflow menu once the table has painted.
 *
 * The menu is a Radix popover with no controlled prop, so a static story cannot render it open
 * any other way. Pointerdown, not click: that is the event the trigger listens for.
 */
const OpenFirstRowMenu = ({children}: {children: ReactNode}) => {
    const host = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const id = window.setTimeout(() => {
            const firstRow = host.current?.querySelector("tbody tr")
            const buttons = firstRow?.querySelectorAll("button")
            const kebab = buttons?.[buttons.length - 1]
            kebab?.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, button: 0}))
        }, 60)
        return () => window.clearTimeout(id)
    }, [])
    return <div ref={host}>{children}</div>
}

const meta = {
    title: "@agenta/settings-ui/Mcp/McpServersSection",
    component: McpServersSection,
    parameters: {layout: "padded"},
    argTypes: {confirm: {action: "confirm"}},
} satisfies Meta<typeof McpServersSection>

export default meta
type Story = StoryObj<typeof McpServersSection>

/** E1 as the spec draws it: the four columns over a healthy project. */
export const Populated: Story = {
    parameters: {agenta: fixture([LINEAR, AXIOM, MEMORY])},
}

/**
 * Every status and every auth kind the page can report, side by side.
 *
 * Two rows read "Login expired" for different underlying reasons — a revoked OAuth grant and a
 * key the server rejects — because the reader's next step is the same for both.
 */
export const AllStatuses: Story = {
    parameters: {agenta: fixture([LINEAR, AXIOM, MEMORY, OCTOLENS, STALE_KEY])},
}

/**
 * The row menu on a connection that holds an OAuth grant: both destructive verbs below the
 * divider. Disconnect gives the login back and the row stays; Remove takes the connection.
 */
export const RowMenuOpen: Story = {
    parameters: {agenta: fixture([LINEAR, AXIOM, MEMORY])},
    decorators: [
        (Story) => (
            <OpenFirstRowMenu>
                <Story />
            </OpenFirstRowMenu>
        ),
    ],
}

/**
 * The same menu on a server that needs no credential: Disconnect is absent.
 *
 * There is no grant to give back, and the revoke route refuses anything that is not a custom
 * OAuth target, so the action would be a 400 on a row that reads as connected. Remove is still
 * offered, so the row is not a dead end.
 */
export const RowMenuNoGrant: Story = {
    parameters: {agenta: fixture([MEMORY, LINEAR])},
    decorators: [
        (Story) => (
            <OpenFirstRowMenu>
                <Story />
            </OpenFirstRowMenu>
        ),
    ],
}

/** E2: the page before any connection exists, with the header button dropped. */
export const Empty: Story = {
    parameters: {agenta: fixture([])},
}

/** Three skeleton rows rather than a collapsed page. */
export const Loading: Story = {
    parameters: {agenta: loadingFixture},
}

/** A viewer with no write access: the list, and nothing that changes it. */
export const ReadOnly: Story = {
    args: {readOnly: true},
    parameters: {agenta: fixture([LINEAR, AXIOM, OCTOLENS])},
}
