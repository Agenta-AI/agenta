import {ModelSetupBanner} from "@agenta/chat/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {AgentaDataParameters} from "../../.storybook/decorators/withAgentaData"

/**
 * The one banner the needs-setup check raises: only when a model item needs setup. The chat
 * shows the strip above the composer; the config pane shows the alert. Seeded through the query
 * cache, so the story runs the same requirement lookup the app runs.
 */
const REVISION_ID = "019d952f-0000-7000-8000-000000000001"

const requirementsFixture = (canEdit: boolean, blocksRun = true): AgentaDataParameters => ({
    queries: (scope) => [
        [
            ["workflows", "requirements", scope.projectId, REVISION_ID],
            {
                count: 1,
                status: "needs_setup",
                requirements: [
                    {
                        key: blocksRun ? "model:openai/gpt-5.5" : "mcp_server:linear",
                        kind: blocksRun ? "model" : "mcp_server",
                        label: blocksRun ? "gpt-5.5" : "Linear",
                        reference: blocksRun
                            ? {provider: "openai", model: "gpt-5.5"}
                            : {slug: "linear"},
                        paths: [blocksRun ? "agent.llm.model" : "agent.mcps[0].connection"],
                        reason: blocksRun ? "not_available" : "not_found",
                        blocks_run: blocksRun,
                        fix: {can_edit_agent: canEdit, can_connect: canEdit, can_sign_in: false},
                    },
                ],
            },
        ],
    ],
})

const meta = {
    title: "@agenta/chat/ModelSetupBanner",
    component: ModelSetupBanner,
    parameters: {layout: "padded"},
    args: {revisionId: REVISION_ID, onSetUp: () => undefined},
    decorators: [(Story) => <div className="max-w-[560px]">{Story()}</div>],
} satisfies Meta<typeof ModelSetupBanner>

export default meta
type Story = StoryObj<typeof ModelSetupBanner>

export const ChatStrip: Story = {
    args: {layout: "strip"},
    parameters: {agenta: requirementsFixture(true)},
}

export const ConfigPaneAlert: Story = {
    args: {layout: "alert"},
    parameters: {agenta: requirementsFixture(true)},
}

/** A viewer who cannot edit the agent: the same words, no button. */
export const ReadOnlyViewer: Story = {
    args: {layout: "strip"},
    parameters: {agenta: requirementsFixture(false)},
}

/** A tool, MCP server, secret or app connection never raises the banner: nothing renders. */
export const NonModelItemShowsNothing: Story = {
    args: {layout: "strip"},
    parameters: {agenta: requirementsFixture(true, false)},
}
