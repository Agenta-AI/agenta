import {useState} from "react"

import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export the add drawer.
import {AgentIntegrationDrawer} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentIntegrationDrawer"
import {buildIntegrationRows} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {
    GITHUB_PERSONAL,
    GITHUB_WORK,
    integrationQueries,
    LINEAR_BROKEN,
    SLACK_OPS,
} from "../../fixtures/gatewayIntegration"

/**
 * **Data-connected drawer story.** Adding an integration to the agent. The drawer leads with the
 * apps already connected in the workspace, because that is the one-click case, and puts the whole
 * catalog behind it for apps that still need connecting.
 *
 * Adding is integration-level: one entry per provider and integration, carrying every tool the app
 * has. There is no per-action add here — that was the pre-rework shape, and a row still holding it
 * says so rather than offering a second, conflicting way in.
 */
const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentIntegrationDrawer",
    component: AgentIntegrationDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Add-integration drawer: a category rail, a search box, the workspace's " +
                    "connected apps as one-click adds, and the full catalog with a Connect leaf " +
                    "for apps with no connection yet.",
            },
        },
    },
} satisfies Meta<typeof AgentIntegrationDrawer>

export default meta
type Story = StoryObj

const noop = () => undefined

const entry = (integration: string, slug: string) => ({
    type: "gateway_connection",
    connection: {provider: "composio", integration, slug},
    policy: {permissions: {default: "inherit", tools: {}}},
})

const legacyEntry = (integration: string, action: string, connection: string) => ({
    type: "function",
    function: {name: `tools__composio__${integration}__${action}__${connection}`},
})

// The drawer is a controlled overlay, so the story owns `open`, with a re-open button so it stays
// usable after a close.
function DrawerHost({tools = [] as unknown[]}) {
    const [open, setOpen] = useState(true)
    return (
        <div data-vrt-subject className="min-h-[560px]">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Add integration
            </Button>
            <AgentIntegrationDrawer
                open={open}
                onClose={() => setOpen(false)}
                integrationRows={buildIntegrationRows(tools)}
                onAddIntegration={noop}
            />
        </div>
    )
}

/**
 * Nothing added yet: every connected app offers Add, and the apps with no connection sit under
 * "All apps" with a Connect leaf.
 */
export const Default: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, SLACK_OPS]}),
        },
    },
    render: () => <DrawerHost />,
}

/**
 * GitHub is already on the agent, so its row reads "Added" and offers to point the entry at the
 * other connection instead. A swap REPLACES the one entry the format allows; it never appends a
 * second.
 */
export const AlreadyAdded: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, SLACK_OPS]}),
        },
    },
    render: () => <DrawerHost tools={[entry("github", GITHUB_WORK.slug ?? "")]} />,
}

/**
 * Two connections for one app. There is no unambiguous one-click add, so the row opens a chooser
 * and the author names the connection the agent runs under.
 */
export const MultipleConnections: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {
                    connections: [GITHUB_WORK, GITHUB_PERSONAL, SLACK_OPS],
                }),
        },
    },
    render: () => <DrawerHost />,
}

/**
 * A connection the project reports as invalid. The connect flow treats the provider popup closing
 * as success, so an abandoned authorization can leave a connection that exists but does not work —
 * the row stays with its reconnect hint rather than offering an Add that would fail at run time.
 */
export const InvalidConnection: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, LINEAR_BROKEN]}),
        },
    },
    render: () => <DrawerHost />,
}

/**
 * An integration still held in the pre-rework per-action format. It is not offered as an add: the
 * row says it is already there in the old format, and migrating it happens where its permissions
 * are edited, not here.
 */
export const OldFormatRow: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, SLACK_OPS]}),
        },
    },
    render: () => (
        <DrawerHost
            tools={[
                legacyEntry("github", "CREATE_ISSUE", GITHUB_WORK.slug ?? ""),
                legacyEntry("github", "GET_ISSUE", GITHUB_WORK.slug ?? ""),
            ]}
        />
    ),
}
