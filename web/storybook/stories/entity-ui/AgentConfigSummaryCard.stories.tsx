import {AgentConfigSummaryCard} from "@agenta/entity-ui/agent"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {AgentaDataParameters} from "../../.storybook/decorators/withAgentaData"

const fixture = (agent: Record<string, unknown>): AgentaDataParameters => ({
    args: (scope) => ({appId: scope.id("agent")}),
    queries: (scope) => [
        [
            ["agent-overview", "latest-revision", scope.projectId, scope.id("agent")],
            {id: scope.id("revision"), data: {parameters: {agent}}},
        ],
    ],
})

const meta = {
    title: "@agenta/entity-ui/Agent/AgentConfigSummaryCard",
    component: AgentConfigSummaryCard,
    parameters: {layout: "padded"},
    decorators: [
        (Story) => (
            <div className="max-w-sm">
                <Story />
            </div>
        ),
    ],
    argTypes: {onEdit: {action: "edit"}},
} satisfies Meta<typeof AgentConfigSummaryCard>

export default meta
type Story = StoryObj<typeof AgentConfigSummaryCard>

export const ReadOnly: Story = {
    args: {onEdit: undefined},
    parameters: {agenta: fixture({llm: {model: "gpt-5"}, runner: {permissions: {default: "ask"}}})},
}

export const Editor: Story = {
    parameters: {
        agenta: fixture({llm: {model: "gpt-5"}, runner: {permissions: {default: "allow_reads"}}}),
    },
}

export const MissingReadOnly: Story = {
    args: {onEdit: undefined},
    parameters: {agenta: fixture({})},
}

export const MissingEditor: Story = {
    parameters: {agenta: fixture({})},
}

export const Instructions: Story = {
    args: {onEdit: undefined},
    parameters: {
        agenta: fixture({
            instructions: {agents_md: "Read the issue carefully before proposing a fix."},
            runner: {permissions: {default: "deny"}},
        }),
    },
}
