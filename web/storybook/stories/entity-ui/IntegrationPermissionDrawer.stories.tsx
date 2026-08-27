import {useState} from "react"

import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export the permission drawer.
import {IntegrationPermissionDrawer} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/IntegrationPermissionDrawer"
import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {GITHUB_TOOLS, GITHUB_WORK, integrationQueries} from "../../fixtures/gatewayIntegration"

/**
 * **Data-connected drawer story.** Where an author decides what the agent may do with ONE
 * integration: a default preset, and a per-tool override for any tool that needs its own rule.
 *
 * It shows what is SAVED and never resolves `inherit` into `allow` or `ask` — doing that would put
 * a second copy of the permission compiler in TypeScript, reading an agent-wide mode this drawer
 * does not own. The runner is the only place an effective permission is computed, so a rollup that
 * reads "follows the agent policy" is the honest answer, not a missing one.
 *
 * The seeded catalog is what makes the body real: the read-only partition comes from each action's
 * `read_only` flag, the counts describe the whole integration, and a saved key the catalog no
 * longer lists is marked rather than dropped.
 */
const meta = {
    title: "@agenta/entity-ui/DrillIn/IntegrationPermissionDrawer",
    component: IntegrationPermissionDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "One integration's permission policy: a preset select, a tool search, and two " +
                    "collapsible groups (read-only, write and delete) with a per-tool select " +
                    "carrying four values — Follow agent policy, Ask, Allow, Deny.",
            },
        },
    },
} satisfies Meta<typeof IntegrationPermissionDrawer>

export default meta
type Story = StoryObj

const noop = () => undefined

const TARGET = {provider: "composio", integration: "github"}

// The drawer is a controlled overlay, so the story owns `open` — same host pattern as the other
// prop-driven drawers here, with a re-open button so the story stays usable after a close.
function DrawerHost({
    permissions,
    connectionSlug = GITHUB_WORK.slug ?? "",
    agentPolicy,
    disabled,
}: {
    permissions: Parameters<typeof IntegrationPermissionDrawer>[0]["permissions"]
    connectionSlug?: string
    agentPolicy?: Parameters<typeof IntegrationPermissionDrawer>[0]["agentPolicy"]
    disabled?: boolean
}) {
    const [open, setOpen] = useState(true)
    return (
        <div data-vrt-subject className="min-h-[560px]">
            <Button variant="outline" onClick={() => setOpen(true)}>
                Open permissions
            </Button>
            <IntegrationPermissionDrawer
                open={open}
                onClose={() => setOpen(false)}
                target={TARGET}
                connectionSlug={connectionSlug}
                permissions={permissions}
                onChangePermissions={noop}
                onChangeToolPermission={noop}
                agentPolicy={agentPolicy}
                disabled={disabled}
            />
        </div>
    )
}

const seeded = (catalog = GITHUB_TOOLS) => ({
    agenta: {queries: (scope: StoryScope) => integrationQueries(scope, {catalog})},
})

/**
 * The default an integration is added with: `allow` and no overrides. Both groups are collapsed
 * to their rollups until the author opens one.
 */
export const Default: Story = {
    parameters: seeded(),
    render: () => <DrawerHost permissions={{default: "allow", tools: {}}} />,
}

/**
 * A denied tool. `GITHUB_DELETE_REPO` carries no `read_only` flag at all, so it partitions as a
 * write — an absent flag must never read as safe.
 */
export const DeniedTool: Story = {
    parameters: seeded(),
    render: () => (
        <DrawerHost permissions={{default: "inherit", tools: {GITHUB_DELETE_REPO: "deny"}}} />
    ),
}

/**
 * Custom, with its count. The preset select shows "Custom" disabled — it is derived from the saved
 * tools map, never chosen — and the count is the number of SAVED entries, including one that
 * happens to equal the default. An author who set a value explicitly gets to keep seeing it.
 */
export const CustomWithOverrides: Story = {
    parameters: seeded(),
    render: () => (
        <DrawerHost
            permissions={{
                default: "ask",
                tools: {
                    GITHUB_GET_ISSUE: "allow",
                    GITHUB_MERGE_PR: "deny",
                    // Redundant against the default, and still counted.
                    GITHUB_CREATE_ISSUE: "ask",
                },
            }}
        />
    ),
}

/**
 * A saved key the provider catalog no longer lists. It is marked rather than dropped: silently
 * removing it would erase a rule the author wrote, and the mark is the only way they learn the
 * tool is gone. Only ever shown against a COMPLETE catalog — a partial list would accuse every
 * unloaded tool of being stale.
 */
export const StaleToolKey: Story = {
    parameters: seeded(),
    render: () => (
        <DrawerHost
            permissions={{
                default: "inherit",
                tools: {GITHUB_MERGE_PR: "deny", GITHUB_RETIRED_ACTION: "allow"},
            }}
        />
    ),
}

/** With an agent-wide policy to name, the note under the select says what `inherit` resolves to. */
export const WithAgentPolicy: Story = {
    parameters: seeded(),
    render: () => (
        <DrawerHost permissions={{default: "inherit", tools: {}}} agentPolicy="allow_reads" />
    ),
}

/**
 * The legacy multi-connection case (qa.md F17). Its per-action entries span two different
 * connections, so there is no single connection for one policy to apply to and nothing was
 * migrated. The drawer explains that instead of editing a policy that does not exist.
 */
export const UnmigratedTwoConnections: Story = {
    parameters: seeded(),
    render: () => <DrawerHost permissions={null} connectionSlug="" />,
}

/** Read-only revision: every control is inert, and the policy stays readable. */
export const ReadOnly: Story = {
    parameters: seeded(),
    render: () => (
        <DrawerHost permissions={{default: "ask", tools: {GITHUB_MERGE_PR: "deny"}}} disabled />
    ),
}
