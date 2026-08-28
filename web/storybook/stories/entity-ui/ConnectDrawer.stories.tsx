import {ConnectDrawer} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {GITHUB_WORK, integrationQueries} from "../../fixtures/gatewayIntegration"

/**
 * **Data-connected modal story.** Making a connection to an integration.
 *
 * The author names the connection and nothing else. The slug is derived from that name and never
 * shown: it is a wire identifier (it ends up inside `tools__composio__github__ACTION__<slug>`),
 * carries provider rules an author has no reason to learn, and every earlier version of this form
 * asked for it first and let the name go blank.
 *
 * The name is seeded from how many connections the integration already has, so a second account
 * arrives as "(secondary)" rather than a second thing called "GitHub".
 */
const meta = {
    title: "@agenta/entity-ui/GatewayTool/ConnectDrawer",
    component: ConnectDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Connect form: a Name field and an auth method. No slug field — the slug is " +
                    "derived from the name.",
            },
        },
    },
} satisfies Meta<typeof ConnectDrawer>

export default meta
type Story = StoryObj

const noop = () => undefined

const host = (props: Partial<Parameters<typeof ConnectDrawer>[0]> = {}) => (
    <div data-vrt-subject className="min-h-[520px]">
        <ConnectDrawer
            open
            integrationKey="github"
            integrationName="GitHub"
            integrationDescription="Repos, issues and pull requests"
            authSchemes={["oauth", "api_key"]}
            onClose={noop}
            {...props}
        />
    </div>
)

/** The project's first GitHub connection: seeded "GitHub (main)". */
export const FirstConnection: Story = {
    parameters: {
        agenta: {queries: (scope: StoryScope) => integrationQueries(scope, {connections: []})},
    },
    render: () => host(),
}

/** A second one, from the same form: seeded "GitHub (secondary)". */
export const SecondConnection: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => integrationQueries(scope, {connections: [GITHUB_WORK]}),
        },
    },
    render: () => host(),
}

/** One auth scheme, so the method select is not offered — Name is the whole form. */
export const SingleAuthScheme: Story = {
    parameters: {
        agenta: {queries: (scope: StoryScope) => integrationQueries(scope, {connections: []})},
    },
    render: () => host({authSchemes: ["oauth"]}),
}
