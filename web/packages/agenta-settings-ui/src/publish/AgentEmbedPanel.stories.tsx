import type {Meta, StoryObj} from "@storybook/nextjs"

import {AgentEmbedPanel} from "./AgentEmbedPanel"
import type {EmbedClient} from "./embedApi"

const AGENT = "019d952f-0000-0000-0000-000000000010"

const fakeClient = (embeds: Record<string, unknown>[], fail = false): EmbedClient => ({
    queryChannelConnections: async () => {
        if (fail) throw new Error("Could not load the embeds.")
        return {connections: embeds}
    },
    queryChannelAgents: async () => ({
        agents: [
            {id: "ca-1", flags: {is_default: true}, data: {references: {application: {id: AGENT}}}},
        ],
    }),
    createChannelAgent: async () => ({}),
    editChannelAgent: async () => ({}),
    createChannelConnection: async () => ({connection: {id: "new"}}),
    editChannelConnection: async () => ({}),
    archiveChannelConnection: async () => ({}),
    fetchChannelConnectionSetup: async () => ({
        setup: {
            document: {
                content:
                    '<iframe\n  id="agenta-chat"\n  src="https://cloud.agenta.ai/m/embed/pub-1"\n></iframe>',
            },
        },
    }),
})

const EMBED = {
    id: "e1",
    channel: "embed",
    name: "Support widget",
    data: {
        connection_locator: {embed: "pub-1"},
        allowed_origins: "https://tool.example.com",
        appearance: {
            greeting: "Hi, how can I help?",
            starters: ["Track my order"],
            theme: "system",
        },
    },
}

/** **Publish > Embed.** The agent's embeds and a form for a new one, or one embed's settings. */
const meta = {
    title: "@agenta/settings-ui/Publish/AgentEmbedPanel",
    component: AgentEmbedPanel,
    parameters: {layout: "padded"},
    args: {
        client: fakeClient([EMBED]),
        projectId: "019d952f-0000-0000-0000-000000000000",
        agentId: AGENT,
        agentName: "Support agent",
        connectionId: null,
        onOpen: () => undefined,
        onBack: () => undefined,
        widgetUrl: () => "about:blank",
    },
} satisfies Meta<typeof AgentEmbedPanel>

export default meta
type Story = StoryObj<typeof meta>

export const List: Story = {}

export const Empty: Story = {args: {client: fakeClient([])}}

export const LoadError: Story = {args: {client: fakeClient([], true)}}

export const Settings: Story = {args: {connectionId: "e1"}}
