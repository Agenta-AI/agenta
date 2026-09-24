import {describe, expect, it, vi} from "vitest"

import {buildAgentChannelsActions, type ChannelsClientLike} from "../../src/channels/actions"

const connection = (overrides: Record<string, unknown> = {}) => ({
    id: "connection-1",
    channel: "telegram_hosted",
    flags: {is_hosted: true, is_active: true},
    ...overrides,
})
const agent = (appId = "app-1") => ({
    id: "agent-1",
    flags: {is_default: true},
    data: {references: {application: {id: appId}}},
})
const fixture = () => {
    const client = {
        queryChannelConnections: vi.fn().mockResolvedValue({connections: [connection()]}),
        queryChannelAgents: vi.fn().mockResolvedValue({agents: [agent()]}),
        queryChannelSpaces: vi.fn().mockResolvedValue({spaces: []}),
        listTelegramHostedBindings: vi.fn().mockResolvedValue({count: 1}),
        editChannelAgent: vi.fn().mockResolvedValue({}),
        createChannelAgent: vi.fn().mockResolvedValue({}),
        archiveChannelConnection: vi.fn().mockResolvedValue({}),
    }
    const actions = buildAgentChannelsActions({
        client: client as unknown as ChannelsClientLike,
        projectId: () => "project-1",
        appId: "app-1",
        resolveAgentName: (id) => (id === "app-1" ? "First agent" : "Other agent"),
        hostedSlackInstallUrl: () => null,
    })
    return {client, actions}
}

describe("Channels connection state", () => {
    it("rejects an ownership lookup failure instead of claiming this agent owns it", async () => {
        const {client, actions} = fixture()
        client.queryChannelAgents.mockRejectedValue({statusCode: 503})
        await expect(actions.reload()).rejects.toThrow("Could not determine which agent")
    })

    it("rejects an unknown binding state instead of claiming Telegram is connected", async () => {
        const {client, actions} = fixture()
        client.listTelegramHostedBindings.mockRejectedValue({statusCode: 503})
        await expect(actions.reload()).rejects.toThrow("Could not check whether Telegram is linked")
    })

    it("distinguishes pending, connected and unassigned", async () => {
        const {client, actions} = fixture()
        client.listTelegramHostedBindings.mockResolvedValueOnce({count: 0})
        expect((await actions.reload()).telegram?.status).toBe("pending")
        expect((await actions.reload()).telegram?.status).toBe("connected")
        client.queryChannelAgents.mockResolvedValueOnce({agents: []})
        expect((await actions.reload()).telegram?.agent).toBeNull()
    })

    it("preserves revoked state without checking bindings", async () => {
        const {client, actions} = fixture()
        client.queryChannelConnections.mockResolvedValue({
            connections: [connection({flags: {is_hosted: true, is_active: false}})],
        })
        expect((await actions.reload()).telegram?.status).toBe("revoked")
        expect(client.listTelegramHostedBindings).not.toHaveBeenCalled()
    })

    it("keeps the current agent's connection ahead of another agent's live connection", async () => {
        const {client, actions} = fixture()
        client.queryChannelConnections.mockResolvedValue({
            connections: [connection({id: "other"}), connection()],
        })
        client.queryChannelAgents.mockResolvedValueOnce({agents: [agent("other-app")]})
        expect((await actions.reload()).telegram?.connectionId).toBe("connection-1")
    })

    it("lists every connection that answers as this agent, the summarized one first", async () => {
        const {client, actions} = fixture()
        client.queryChannelConnections.mockResolvedValue({
            connections: [
                connection({id: "other", channel: "telegram", flags: {is_active: true}}),
                connection({id: "mine-revoked", channel: "telegram", flags: {is_active: false}}),
                connection(),
                connection({
                    id: "slack-1",
                    channel: "slack",
                    flags: {is_active: true},
                    data: {team_name: "Acme"},
                }),
            ],
        })
        client.queryChannelAgents.mockImplementation(
            async ({agent: {connection_id}}: {agent: {connection_id: string}}) => ({
                agents: [agent(connection_id === "other" ? "other-app" : "app-1")],
            }),
        )
        const next = await actions.reload()
        expect(next.telegram?.connectionId).toBe("connection-1")
        expect(next.agentConnections?.telegram.map((c) => c.connectionId)).toEqual([
            "connection-1",
            "mine-revoked",
        ])
        expect(next.agentConnections?.slack.map((c) => c.workspaceName)).toEqual(["Acme"])
    })

    it("retargets only when necessary and scopes the write to this project", async () => {
        const {client, actions} = fixture()
        await actions.connectHere("telegram", "connection-1")
        expect(client.editChannelAgent).not.toHaveBeenCalled()
        client.queryChannelAgents.mockResolvedValueOnce({agents: [agent("other-app")]})
        await actions.connectHere("telegram", "connection-1")
        expect(client.editChannelAgent).toHaveBeenCalledWith(
            {
                agent_id: "agent-1",
                agent: {id: "agent-1", data: {references: {application: {id: "app-1"}}}},
            },
            {queryParams: {project_id: "project-1"}},
        )
    })

    it("propagates disconnect failures without reporting success", async () => {
        const {client, actions} = fixture()
        client.archiveChannelConnection.mockRejectedValue({statusCode: 503})
        await expect(actions.disconnect("telegram", "connection-1")).rejects.toThrow(
            "Could not disconnect",
        )
    })
})
