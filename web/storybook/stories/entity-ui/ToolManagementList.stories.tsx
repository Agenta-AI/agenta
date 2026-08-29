import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export the integration list.
import {ToolManagementList} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ToolManagementList"
import {buildIntegrationRows} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {integrationQueries, GITHUB_WORK, SLACK_OPS} from "../../fixtures/gatewayIntegration"

// Rows are built by the real `buildIntegrationRows`, so no story can show a shape the parser would
// not produce.
const meta = {
    title: "@agenta/entity-ui/DrillIn/ToolManagementList",
    component: ToolManagementList,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The Integrations section body. Each row summarizes one integration's " +
                    "saved policy as a preset label, or as 'Custom · N' when per-tool overrides " +
                    "are saved. An integration still held in the pre-rework per-action format is " +
                    "tagged 'old format' and shows no policy, because it has none yet. The list " +
                    "draws no sub-header and no add button: the accordion section header owns " +
                    "the title, the count, and the plus.",
            },
        },
    },
} satisfies Meta<typeof ToolManagementList>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const entry = (integration: string, slug: string, permissions: Record<string, unknown>) => ({
    type: "gateway_connection",
    connection: {provider: "composio", integration, slug},
    policy: {permissions},
})

/** The pre-rework shape: one entry per action, with the permission on the entry. */
const legacyEntry = (integration: string, action: string, connection: string) => ({
    type: "function",
    function: {name: `tools__composio__${integration}__${action}__${connection}`},
    permission: "ask",
})

const TOOLS = [
    // allow_all — the default preset, written as `allow` with no overrides.
    entry("github", GITHUB_WORK.slug ?? "", {default: "allow", tools: {}}),
    // Custom · 2 — a preset plus two saved per-tool values.
    entry("slack", SLACK_OPS.slug ?? "", {
        default: "ask",
        tools: {SLACK_SEND_MESSAGE: "allow", SLACK_DELETE_MESSAGE: "deny"},
    }),
    // Never migrated: two legacy entries, no connection entry, so no policy to summarize.
    legacyEntry("linear", "CREATE_ISSUE", "linear-main"),
    legacyEntry("linear", "GET_ISSUE", "linear-main"),
]

const listArgs = (tools: unknown[]) => ({
    tools,
    integrationRows: buildIntegrationRows(tools),
    emptyAdd: <a>add an integration</a>,
    onOpenIntegration: noop,
    onRemoveIntegration: noop,
})

// Showcase, not an antd parity pair. `data-vrt-subject` is the harness's readiness marker.
const Frame = (children: React.ReactNode) => (
    <div data-vrt-subject className="w-[520px]">
        {children}
    </div>
)

/** A default preset, a Custom row with its override count, and an unmigrated "old format" row. */
export const RowStates: Story = {
    args: listArgs(TOOLS),
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, SLACK_OPS]}),
        },
    },
    render: (args) => Frame(<ToolManagementList {...args} />),
}

/** Every preset an integration row can summarize, so the labels can be read against each other. */
export const EveryPreset: Story = {
    args: listArgs([
        entry("github", "github-work", {default: "ask", tools: {}}),
        entry("slack", "slack-ops", {default: "inherit", tools: {}}),
        entry("linear", "linear-main", {default: "allow", tools: {}}),
        entry("notion", "notion-main", {default: "deny", tools: {}}),
    ]),
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, SLACK_OPS]}),
        },
    },
    render: (args) => Frame(<ToolManagementList {...args} />),
}

/**
 * Read-only revision. Rows lose the chevron, the Remove button and the tab stop — a disabled row
 * that still read as a button invoked a handler that did nothing.
 */
export const ReadOnly: Story = {
    args: {...listArgs(TOOLS), disabled: true, onOpenIntegration: undefined},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, SLACK_OPS]}),
        },
    },
    render: (args) => Frame(<ToolManagementList {...args} />),
}

/**
 * No integrations yet. The body is one line that carries the add link, because the section header's
 * plus is easy to miss on a section the reader has just opened for the first time.
 */
export const Empty: Story = {
    args: listArgs([]),
    render: (args) => Frame(<ToolManagementList {...args} />),
}

/** Read-only and empty: the line disappears rather than offering an add the revision cannot do. */
export const EmptyReadOnly: Story = {
    args: {...listArgs([]), disabled: true},
    render: (args) => Frame(<ToolManagementList {...args} />),
}
