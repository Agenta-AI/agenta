import {useState} from "react"

import {draftItemAccountsKey, type ItemAccount} from "@agenta/entities/accountChoice"
import type {ToolConnection} from "@agenta/entities/gatewayTool"
import type {MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {userAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export the drawer or the blocks.
import {IntegrationAccountBlock} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/accounts/IntegrationAccountBlock"
import {McpAccountBlock} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/accounts/McpAccountBlock"
import {IntegrationPermissionDrawer} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/IntegrationPermissionDrawer"
import type {
    GatewayConnectionAccount,
    ParsedGatewayConnection,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    GITHUB_PERSONAL,
    GITHUB_WORK,
    connection,
    integrationQueries,
} from "../../fixtures/gatewayIntegration"

/**
 * The "Account" block at the top of an item's drawer (approved boards
 * `editor-gmail-permissions` and `editor-linear-permissions`): whose account the item runs under,
 * and, for each person's own account, which one the viewer gets when they run it.
 */
const meta = {
    title: "@agenta/entity-ui/AgentTemplate/AccountBlock",
    parameters: {layout: "padded"},
} satisfies Meta

export default meta
type Story = StoryObj

const USER_ID = "user-account-block-story"
const WORKFLOW_ID = "0193a000-0000-7000-8000-000000000001"
const TARGET = {provider: "composio", integration: "github"}
const MINE: ToolConnection = {
    ...connection("github-bob", "github", {is_active: true, is_valid: true}, "bob@acme.com"),
    is_default: true,
} as ToolConnection
const MINE_HOME = connection(
    "github-bob-home",
    "github",
    {is_active: true, is_valid: true},
    "bob.home@example.com",
)

const userEntry: ParsedGatewayConnection = {
    ...TARGET,
    connection: "",
    accountSource: "user",
    permissions: {default: "allow", tools: {}},
}
const agentWith = (entry: ParsedGatewayConnection) => ({
    tools: [
        {
            type: "gateway_connection",
            connection:
                entry.accountSource === "user"
                    ? {...TARGET, account_source: "user"}
                    : {...TARGET, slug: entry.connection},
        },
    ],
})

const seeded = ({
    personal = true,
    yours = [MINE, MINE_HOME],
    account,
}: {
    /** Personal accounts on for the deployment. Off reads as "not known yet": no option. */
    personal?: boolean
    yours?: ToolConnection[]
    account?: ItemAccount
} = {}) => ({
    agenta: {
        atoms: [[userAtom, {id: USER_ID, email: "bob@acme.com"}]] as [typeof userAtom, unknown][],
        queries: (scope: StoryScope) => [
            ...integrationQueries(scope, {connections: [GITHUB_WORK, GITHUB_PERSONAL]}),
            ...(personal
                ? ([
                      [["vault", "personal-secrets", USER_ID, scope.projectId], []],
                      [["tools", "connections", "user", scope.projectId], yours],
                      [
                          [
                              "account-choices",
                              "resolve-draft",
                              scope.projectId,
                              draftItemAccountsKey(WORKFLOW_ID, agentWith(userEntry)),
                          ],
                          account ? [account] : [],
                      ],
                  ] as [unknown[], unknown][])
                : []),
        ],
    },
})

function DrawerHost({initial}: {initial: ParsedGatewayConnection}) {
    const [entry, setEntry] = useState(initial)
    const onChange = (account: GatewayConnectionAccount) =>
        setEntry((current) =>
            account.kind === "user"
                ? {...current, connection: "", accountSource: "user"}
                : {...current, connection: account.slug, accountSource: undefined},
        )
    return (
        <div data-vrt-subject className="min-h-[560px]">
            <IntegrationPermissionDrawer
                open
                onClose={() => undefined}
                target={TARGET}
                connectionSlug={entry.connection}
                permissions={entry.permissions}
                onChangePermissions={() => undefined}
                onChangeToolPermission={() => undefined}
                account={
                    <IntegrationAccountBlock
                        target={TARGET}
                        entry={entry}
                        context={{
                            revisionId: null,
                            workflowId: WORKFLOW_ID,
                            agent: agentWith(entry),
                        }}
                        onChange={onChange}
                    />
                }
            />
        </div>
    )
}

/** Each person's default: the viewer's own default account, with Change. */
export const EachPersonDefault: Story = {
    parameters: seeded({
        account: {
            item_key: "app_connection:user/github",
            match: "default",
            gateway_connection_id: MINE.id,
            name: "bob@acme.com",
            is_ready: true,
            candidates: 2,
        },
    }),
    render: () => <DrawerHost initial={userEntry} />,
}

/** The viewer picked another of their accounts for this agent: Change offers to make it default. */
export const EachPersonChosen: Story = {
    parameters: seeded({
        account: {
            item_key: "app_connection:user/github",
            match: "choice",
            gateway_connection_id: MINE_HOME.id,
            name: "bob.home@example.com",
            is_ready: true,
            candidates: 2,
        },
    }),
    render: () => <DrawerHost initial={userEntry} />,
}

/** The viewer has no account of their own for the integration yet. */
export const EachPersonNoAccount: Story = {
    parameters: seeded({yours: []}),
    render: () => <DrawerHost initial={userEntry} />,
}

/** A project connection: the select names it, and there is no line. */
export const ProjectConnection: Story = {
    parameters: seeded(),
    render: () => (
        <DrawerHost initial={{...userEntry, connection: "github-work", accountSource: undefined}} />
    ),
}

/** Personal accounts off: only the project's connections are offered. */
export const PersonalAccountsOff: Story = {
    parameters: seeded({personal: false}),
    render: () => (
        <DrawerHost initial={{...userEntry, connection: "github-work", accountSource: undefined}} />
    ),
}

const endpoint = (over: Partial<MCPEndpoint>): MCPEndpoint =>
    ({
        id: "mcp-linear",
        slug: "linear",
        name: "Linear",
        namespace: "custom",
        auth_mode: "oauth",
        data: {route: {base_url: "https://mcp.linear.app/sse"}},
        user_sign_in: null,
        ...over,
    }) as MCPEndpoint

function McpHost({initial}: {initial: MCPEndpoint}) {
    const [source, setSource] = useState<"user" | "project">("user")
    return (
        <div className="w-[480px]">
            <McpAccountBlock endpoint={initial} source={source} onChange={setSource} />
        </div>
    )
}

/** Each person's own sign-in, and the viewer is signed in. */
export const McpSignedIn: Story = {
    parameters: seeded(),
    render: () => <McpHost initial={endpoint({user_sign_in: {is_ready: true}})} />,
}

/** Each person's own sign-in, and the viewer has none yet. */
export const McpNotSignedIn: Story = {
    parameters: seeded(),
    render: () => <McpHost initial={endpoint({})} />,
}

/** The viewer's sign-in lapsed. */
export const McpSignInExpired: Story = {
    parameters: seeded(),
    render: () => <McpHost initial={endpoint({user_sign_in: {is_ready: false}})} />,
}

/** A token server: "Sign in" asks for the viewer's own token. */
export const McpTokenServer: Story = {
    parameters: seeded(),
    render: () => <McpHost initial={endpoint({auth_mode: "api_key"})} />,
}
