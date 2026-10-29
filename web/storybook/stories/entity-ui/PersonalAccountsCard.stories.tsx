import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {PersonalAccountsCard, type PersonalSetupItem} from "@agenta/entity-ui/onboarding"
import {userAtom} from "@agenta/shared/state"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {connection, integrationQueries} from "../../fixtures/gatewayIntegration"

/**
 * "Connect your accounts": the setup card above the composer of a chat with an agent that has
 * items using each person's own account (approved board `chat-connect-card`). It lists only the
 * viewer's own missing items, and never blocks sending.
 */
const meta = {
    title: "@agenta/entity-ui/Onboarding/PersonalAccountsCard",
    component: PersonalAccountsCard,
    parameters: {layout: "padded"},
} satisfies Meta<typeof PersonalAccountsCard>

export default meta
type Story = StoryObj<typeof PersonalAccountsCard>

const USER_ID = "user-personal-card-story"
const ACTIVE = {is_active: true, is_valid: true}
const MINE = {
    ...connection("github-bob", "github", ACTIVE, "bob@acme.com"),
    is_default: true,
} as ToolConnection
const MINE_HOME = connection("github-bob-home", "github", ACTIVE, "bob.home@example.com")

const GITHUB: PersonalSetupItem = {
    key: "app_connection:user/github",
    kind: "app_connection",
    name: "github",
    candidates: 2,
}
const SLACK: PersonalSetupItem = {
    key: "app_connection:user/slack",
    kind: "app_connection",
    name: "slack",
    candidates: 0,
}
const LINEAR: PersonalSetupItem = {
    key: "mcp_sign_in:user/linear",
    kind: "mcp",
    name: "linear",
    candidates: 0,
}
const TOKEN: PersonalSetupItem = {
    key: "secret:user/GITHUB_TOKEN",
    kind: "secret",
    name: "GITHUB_TOKEN",
    candidates: 1,
}

const seeded = {
    agenta: {
        atoms: [[userAtom, {id: USER_ID, email: "bob@acme.com"}]] as [typeof userAtom, unknown][],
        queries: (scope: StoryScope) =>
            [
                ...integrationQueries(scope, {connections: []}),
                [
                    ["tools", "connections", "user", scope.projectId],
                    [MINE, MINE_HOME],
                ],
                [
                    ["mcp-endpoints", scope.projectId],
                    [
                        {
                            id: "mcp-linear",
                            slug: "linear",
                            name: "Linear",
                            namespace: "custom",
                            auth_mode: "oauth",
                            data: {route: {base_url: "https://mcp.linear.app/sse"}},
                            user_sign_in: null,
                        },
                    ],
                ],
                [
                    ["vault", "personal-secrets", USER_ID, scope.projectId],
                    [
                        {
                            id: "secret-mine",
                            type: "custom_secret",
                            name: "My GitHub token",
                            slug: "my-github-token",
                            format: "text",
                            hasKey: true,
                        },
                    ],
                ],
            ] as [unknown[], unknown][],
    },
}

const base = {
    workflowId: "0193a000-0000-7000-8000-000000000002",
    onContinue: () => undefined,
    onDismiss: () => undefined,
}

/** Three missing items: pick one of your accounts, sign in, choose one of your secrets. */
export const Missing: Story = {
    parameters: seeded,
    render: () => (
        <div className="w-[720px]">
            <PersonalAccountsCard
                {...base}
                items={[GITHUB, LINEAR, TOKEN]}
                pendingKeys={new Set([GITHUB.key, LINEAR.key, TOKEN.key])}
            />
        </div>
    ),
}

/** No account of your own for the integration yet: one Connect button. */
export const NoAccountYet: Story = {
    parameters: seeded,
    render: () => (
        <div className="w-[720px]">
            <PersonalAccountsCard {...base} items={[SLACK]} pendingKeys={new Set([SLACK.key])} />
        </div>
    ),
}

/** A fixed item stays on the card, marked done, until the card is put away. */
export const OneDone: Story = {
    parameters: seeded,
    render: () => (
        <div className="w-[720px]">
            <PersonalAccountsCard
                {...base}
                items={[GITHUB, LINEAR]}
                pendingKeys={new Set([GITHUB.key])}
            />
        </div>
    ),
}
