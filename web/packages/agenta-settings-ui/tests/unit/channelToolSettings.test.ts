import {describe, expect, it, vi} from "vitest"

import {buildAgentChannelsActions, type ChannelsClientLike} from "../../src/channels/actions"

const agent = (data: Record<string, unknown> = {}) => ({
    id: "agent-1",
    flags: {is_default: true},
    data: {references: {application: {id: "app-1"}}, ...data},
})
const fixture = () => {
    const client = {
        queryChannelAgents: vi.fn().mockResolvedValue({agents: [agent()]}),
        editChannelAgent: vi.fn().mockResolvedValue({}),
        discoverChannelSpaces: vi.fn().mockResolvedValue({candidates: []}),
        queryChannelSpaces: vi.fn().mockResolvedValue({spaces: []}),
    }
    const actions = buildAgentChannelsActions({
        client: client as unknown as ChannelsClientLike,
        projectId: () => "project-1",
        appId: "app-1",
        resolveAgentName: () => null,
        hostedSlackInstallUrl: () => null,
    })
    return {client, actions}
}

describe("Channel tool settings", () => {
    it("reads the defaults when the bot has no tools block", async () => {
        const {actions} = fixture()
        expect(await actions.readToolSettings("connection-1")).toEqual({
            canPostOutsideConversation: true,
            readableSpaceKeys: null,
        })
    })

    it("reads a stored narrowed list and posting off", async () => {
        const {client, actions} = fixture()
        client.queryChannelAgents.mockResolvedValue({
            agents: [
                agent({
                    tools: {can_post_outside_conversation: false, readable_space_keys: ["k1"]},
                }),
            ],
        })
        expect(await actions.readToolSettings("connection-1")).toEqual({
            canPostOutsideConversation: false,
            readableSpaceKeys: ["k1"],
        })
    })

    it("writes only data.tools", async () => {
        const {client, actions} = fixture()
        await actions.writeToolSettings("connection-1", {
            canPostOutsideConversation: false,
            readableSpaceKeys: ["k1", "k2"],
        })
        expect(client.editChannelAgent).toHaveBeenCalledWith(
            {
                agent_id: "agent-1",
                agent: {
                    id: "agent-1",
                    data: {
                        tools: {
                            can_post_outside_conversation: false,
                            readable_space_keys: ["k1", "k2"],
                        },
                    },
                },
            },
            {queryParams: {project_id: "project-1"}},
        )
    })

    it("lists only channels the bot is a member of", async () => {
        const {client, actions} = fixture()
        client.discoverChannelSpaces.mockResolvedValue({
            candidates: [
                {
                    kind: "topic",
                    external_locator: {channel: "C1"},
                    display_name: "#support",
                    membership: "member",
                    external_key: "k1",
                },
                {
                    kind: "topic",
                    external_locator: {channel: "C2"},
                    display_name: "#random",
                    membership: "joinable",
                    external_key: "k2",
                },
                {
                    kind: "topic",
                    external_locator: {channel: "C3"},
                    display_name: "#secret",
                    membership: "invite_required",
                    external_key: "k3",
                },
            ],
        })
        expect(await actions.listReadableChannels("slack", "connection-1")).toEqual([
            {key: "k1", name: "#support", kind: "topic"},
        ])
    })

    it("lists a Telegram bot's stored groups, never its private chats", async () => {
        const {client, actions} = fixture()
        client.queryChannelSpaces.mockResolvedValue({
            spaces: [
                {id: "s1", kind: "private", external_key: "k1", data: {}},
                {id: "s2", kind: "group", name: "Team", external_key: "k2", data: {}},
                {id: "s3", kind: "topic", name: "Releases", external_key: "k3", data: {}},
            ],
        })
        expect(await actions.listReadableChannels("telegram", "connection-1")).toEqual([
            {key: "k2", name: "Team", kind: "group"},
            {key: "k3", name: "Releases", kind: "topic"},
        ])
        expect(client.discoverChannelSpaces).not.toHaveBeenCalled()
    })
})
