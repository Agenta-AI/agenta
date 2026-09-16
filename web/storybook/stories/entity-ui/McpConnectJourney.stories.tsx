import type {McpConnectJourney, McpJourneyState} from "@agenta/entities/mcpEndpoint"
import {McpConnectSheet, type McpConnectSheetProps} from "@agenta/entity-ui/mcpEndpoint"
import {userAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"

// McpConnectJourney — the one sheet for adding an MCP server: the address, then whatever
// authorization the server turned out to want. Twenty-two journey statuses render as six
// screens, and every one of them is below.
//
// `McpConnectSheet` is the rendering half, taking the journey as a prop. The container half
// (`McpConnectJourney`) owns the hook that probes, creates and authorizes, none of which a
// story can do; holding a state still is the only way to look at `consent_cancelled` or the
// sealed save without a provider on the other end.
//
// The project-secret picker is the one thing here that still reads data: it takes
// `customNamedSecretsAtom`, seeded through the data seam (userAtom + the vault query key
// that atom derives from) exactly as McpServerFormView.stories does.
const meta = {
    title: "@agenta/entity-ui/McpEndpoint/McpConnectJourney",
    component: McpConnectSheet,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The connect sheet, state by state. C1 takes the address and checks it; C2 keeps what was typed and says why the check failed; C3 names an OAuth server and explains the window Connect opens; C4 holds while the provider's window is open, and reports a refusal; C5 takes a header and a project secret in one press, or shows only the card and the name for a server that needs no sign-in; C6 flags both credential fields after a refusal. There is no scope picker: the scopes are the server's business.",
            },
        },
    },
} satisfies Meta<typeof McpConnectSheet>

export default meta
type Story = StoryObj<typeof meta>

const SECRETS = [
    {id: "sec-1", type: "custom_secret", name: "axiom_token", slug: "axiom_token"},
    {id: "sec-2", type: "custom_secret", name: "linear_token", slug: "linear_token"},
]

const seed = {
    agenta: {
        atoms: [[userAtom, {id: "user-mcp-story", email: "story@agenta.ai"}]] as [
            typeof userAtom,
            unknown,
        ][],
        queries: (scope: {projectId: string}) => [
            [["vault", "secrets", "user-mcp-story", scope.projectId], SECRETS] as [
                unknown[],
                unknown,
            ],
        ],
    },
}

const OAUTH_PROBE = {
    reachable: true,
    server_name: "Linear",
    auth: {mode: "oauth" as const, scopes_offered: ["read", "write"]},
}

const KEY_PROBE = {
    reachable: true,
    server_name: "Axiom",
    auth: {mode: "unknown" as const, scopes_offered: []},
}

const NO_AUTH_PROBE = {
    reachable: true,
    server_name: "Acme",
    auth: {mode: "none" as const, scopes_offered: []},
}

const state = (
    over: Partial<McpJourneyState> & Pick<McpJourneyState, "status">,
): McpJourneyState => ({
    url: "",
    name: "",
    nameTouched: false,
    probe: null,
    scopesOffered: [],
    scopesSelected: [],
    endpointId: null,
    slug: null,
    createdHere: true,
    tools: [],
    error: null,
    ...over,
})

const noop = () => undefined
const settled = async () => undefined

/** A journey that answers every question and does nothing, so a screen holds still. */
const journeyAt = (current: McpJourneyState): McpConnectJourney => ({
    state: current,
    popupName: "mcp_oauth_story",
    expectsConsent: current.probe?.auth.mode === "oauth",
    setUrl: noop,
    submitUrl: settled,
    loadTools: settled,
    setName: noop,
    submitName: settled,
    toggleScope: noop,
    submitScopes: settled,
    startScopeDiscovery: settled,
    submitManualCredential: settled,
    skipAuthentication: noop,
    finish: settled,
    cancel: settled,
    cancelConsent: noop,
    retry: noop,
    retryTools: noop,
    abandonAttempt: noop,
})

const sheet = (
    current: McpJourneyState,
    reconnect?: Story["args"] extends never ? never : any,
) => ({
    parameters: seed,
    args: {open: true, onClose: noop, journey: journeyAt(current), reconnect},
    render: (args: McpConnectSheetProps) => <McpConnectSheet {...args} />,
})

/** C1 — the address, before anything has been checked. */
export const UrlEntry: Story = sheet(state({status: "url_entry"}))

/** C1 — the check is running; the action carries the spinner and nothing else moves. */
export const UrlProbing: Story = sheet(
    state({status: "checking_url", url: "https://mcp.linear.app/mcp"}),
)

/** C2 — nothing answered. The address is kept and the advice is about reaching it. */
export const UrlUnreachable: Story = sheet(
    state({
        status: "check_failed",
        url: "https://mcp.internal.acme.dev/sse",
        error: "No MCP response from mcp.internal.acme.dev.",
        probe: {
            reachable: false,
            auth: {mode: "unknown", scopes_offered: []},
            problem: {
                cause: "unreachable",
                message: "No MCP response from mcp.internal.acme.dev.",
            },
        },
    }),
)

/** C2 — something answered, and it was not a server. Different headline, no network advice. */
export const UrlNotAnMcpServer: Story = sheet(
    state({
        status: "check_failed",
        url: "https://acme.dev/docs",
        error: "The address answered, but not with an MCP handshake (HTTP 200).",
        probe: {
            reachable: true,
            auth: {mode: "unknown", scopes_offered: []},
            problem: {
                cause: "not_an_mcp_server",
                message: "The address answered, but not with an MCP handshake (HTTP 200).",
            },
        },
    }),
)

/**
 * C2 with a response behind it — the only place "Show response" appears.
 *
 * Nothing in the product reaches this yet: the probe returns a cause and a sentence and
 * drops the body, so `readMcpProbeResponse` answers null everywhere (issue #6908). This
 * story carries one, which is what the panel looks like the day the probe does.
 */
export const UrlUnreachableWithResponse: Story = sheet(
    state({
        status: "check_failed",
        url: "https://acme.dev/mcp",
        error: "The address answered, but not with an MCP handshake (HTTP 502).",
        probe: {
            reachable: true,
            auth: {mode: "unknown", scopes_offered: []},
            problem: {
                cause: "not_an_mcp_server",
                message: "The address answered, but not with an MCP handshake (HTTP 502).",
                response: {
                    status: "502 Bad Gateway",
                    body: "<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>",
                },
            },
        } as NonNullable<McpJourneyState["probe"]>,
    }),
)

/** C3 — an OAuth server, named, with the prefix its tools will carry. */
export const OAuthDetected: Story = sheet(
    state({
        status: "naming",
        url: "https://mcp.linear.app/mcp",
        name: "Linear",
        probe: OAUTH_PROBE,
    }),
)

/** C4 — the provider's window is open. No action row: the window is the action. */
export const OAuthWaiting: Story = sheet(
    state({
        status: "awaiting_consent",
        url: "https://mcp.linear.app/mcp",
        name: "Linear",
        probe: OAUTH_PROBE,
        endpointId: "mcp-1",
        slug: "linear",
    }),
)

/** C4 — the sign-in was closed or refused, and nothing was saved. */
export const OAuthDenied: Story = sheet(
    state({
        status: "consent_cancelled",
        url: "https://mcp.linear.app/mcp",
        name: "Linear",
        probe: OAUTH_PROBE,
        endpointId: "mcp-1",
        slug: "linear",
        error: "Authorization window closed before completion.",
    }),
)

/** C5 — a key server: the header and the secret, decided in one press with the name. */
export const ApiKeyDetected: Story = sheet(
    state({
        status: "naming",
        url: "https://mcp.axiom.co/mcp",
        name: "Axiom",
        probe: KEY_PROBE,
    }),
)

/** C6 — the key was refused. Both credential fields are flagged; nothing was saved. */
export const ApiKeyRejected: Story = sheet(
    state({
        status: "verify_failed",
        url: "https://mcp.axiom.co/mcp",
        name: "Axiom",
        probe: KEY_PROBE,
        endpointId: "mcp-1",
        slug: "axiom",
        error: "The server rejected the credential (401).",
    }),
)

/** C5's other half — a server that asked for nothing shows only the card and the name. */
export const NoAuth: Story = sheet(
    state({
        status: "naming",
        url: "https://mcp.acme.test/mcp",
        name: "Acme",
        probe: NO_AUTH_PROBE,
    }),
)

/** The same key sheet, repairing a connection: the address is read-only and the name is locked. */
export const ReconnectApiKey: Story = sheet(
    state({
        status: "manual_auth",
        url: "https://mcp.axiom.co/mcp",
        name: "Axiom",
        nameTouched: true,
        endpointId: "mcp-9",
        slug: "axiom",
        createdHere: false,
    }),
    {
        id: "mcp-9",
        slug: "axiom",
        name: "Axiom",
        url: "https://mcp.axiom.co/mcp",
        authMode: "api_key" as const,
    },
)

/** The sealed window: the grant exists server-side, so there is no way out of this one. */
export const Saving: Story = sheet(
    state({
        status: "saving",
        url: "https://mcp.linear.app/mcp",
        name: "Linear",
        probe: OAUTH_PROBE,
        endpointId: "mcp-1",
        slug: "linear",
    }),
)
