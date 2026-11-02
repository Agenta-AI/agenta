import type {Meta, StoryObj} from "@storybook/nextjs"

import {AgentApiPanel} from "./AgentApiPanel"

/**
 * **Publish > API.** The API key field, then Python / TypeScript / cURL tabs with a streaming
 * and a JSON snippet that call the agent's default variant at its latest revision.
 */
const meta = {
    title: "@agenta/settings-ui/Publish/AgentApiPanel",
    component: AgentApiPanel,
    parameters: {layout: "padded"},
    args: {
        agentId: "019d952f-0000-0000-0000-000000000010",
        projectId: "019d952f-0000-0000-0000-000000000000",
        workspaceId: "019d952f-0000-0000-0000-000000000020",
        host: "https://eu.cloud.agenta.ai",
    },
} satisfies Meta<typeof AgentApiPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
