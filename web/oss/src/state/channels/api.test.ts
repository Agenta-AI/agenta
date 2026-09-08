import {beforeEach, describe, expect, it, vi} from "vitest"

const mockClient = {
    editChannelAgent: vi.fn(),
    editChannelSpace: vi.fn(),
    editChannelGrant: vi.fn(),
    createChannelSpace: vi.fn(),
    discoverChannelSpaces: vi.fn(),
    setChannelAgentDefault: vi.fn(),
    setChannelGrantDefault: vi.fn(),
}

vi.mock("@agenta/sdk/resources", () => ({
    getChannelsClient: () => mockClient,
}))

vi.mock("@/oss/state/project", () => ({
    projectIdAtom: {},
}))

// Partial mock: `api.ts` now pulls in `@agenta/entities/shared`, whose molecule
// barrel needs jotai's real `atom` at import time, not just `getDefaultStore`.
vi.mock("jotai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("jotai")>()
    return {
        ...actual,
        getDefaultStore: () => ({get: () => "project-1"}),
    }
})

const {
    editChannelAgent,
    editChannelSpace,
    editChannelGrant,
    createChannelSpace,
    discoverChannelSpaces,
    setChannelAgentDefault,
    setChannelGrantDefault,
} = await import("./api")

describe("editChannelAgent — full-PUT discipline", () => {
    beforeEach(() => vi.clearAllMocks())

    it("sends the full ChannelAgentEdit document (data and flags both present), not a partial patch", async () => {
        mockClient.editChannelAgent.mockResolvedValue({agent: {}})

        const fullDocument = {
            id: "agent-1",
            name: "Triage",
            data: {references: {main: {id: "wf-1"}}, policy: {forwardfill: false}},
            flags: {is_active: true, is_default: false},
        }

        await editChannelAgent("agent-1", fullDocument)

        expect(mockClient.editChannelAgent).toHaveBeenCalledWith(
            {agent_id: "agent-1", agent: fullDocument},
            expect.anything(),
        )
        const sentBody = mockClient.editChannelAgent.mock.calls[0][0]
        expect(sentBody.agent.data).toBeDefined()
        expect(sentBody.agent.flags).toBeDefined()
    })
})

describe("editChannelSpace / editChannelGrant — full-PUT discipline", () => {
    beforeEach(() => vi.clearAllMocks())

    it("space edit carries data and flags both present", async () => {
        mockClient.editChannelSpace.mockResolvedValue({space: {}})
        const doc = {id: "space-1", data: {external_locator: {}, policy: {}}, flags: {}}
        await editChannelSpace("space-1", doc)
        const sentBody = mockClient.editChannelSpace.mock.calls[0][0]
        expect(sentBody.space.data).toBeDefined()
        expect(sentBody.space.flags).toBeDefined()
    })

    it("grant edit carries data and flags both present", async () => {
        mockClient.editChannelGrant.mockResolvedValue({grant: {}})
        const doc = {id: "grant-1", data: {policy: {}}, flags: {}}
        await editChannelGrant("grant-1", doc)
        const sentBody = mockClient.editChannelGrant.mock.calls[0][0]
        expect(sentBody.grant.data).toBeDefined()
        expect(sentBody.grant.flags).toBeDefined()
    })
})

describe("space discovery vs create", () => {
    beforeEach(() => vi.clearAllMocks())

    it("discoverChannelSpaces calls the discover route, not create", async () => {
        mockClient.discoverChannelSpaces.mockResolvedValue({candidates: []})
        await discoverChannelSpaces("connection-1")
        expect(mockClient.discoverChannelSpaces).toHaveBeenCalledWith(
            {connection_id: "connection-1"},
            expect.anything(),
        )
        expect(mockClient.createChannelSpace).not.toHaveBeenCalled()
    })

    it("choosing an unconfigured candidate calls createChannelSpace, never editChannelSpace", async () => {
        mockClient.createChannelSpace.mockResolvedValue({space: {}})
        await createChannelSpace({
            connection_id: "connection-1",
            kind: "group",
            external_key: "00000000-0000-0000-0000-000000000000",
            data: {external_locator: {channel: "C123"}},
        })
        expect(mockClient.createChannelSpace).toHaveBeenCalledTimes(1)
        expect(mockClient.editChannelSpace).not.toHaveBeenCalled()
    })
})

describe("default-setting is a dedicated action, never a generic edit", () => {
    beforeEach(() => vi.clearAllMocks())

    it("setChannelAgentDefault calls the dedicated route, not editChannelAgent", async () => {
        mockClient.setChannelAgentDefault.mockResolvedValue({agent: {}})
        await setChannelAgentDefault("agent-1")
        expect(mockClient.setChannelAgentDefault).toHaveBeenCalledWith(
            {agent_id: "agent-1"},
            expect.anything(),
        )
        expect(mockClient.editChannelAgent).not.toHaveBeenCalled()
    })

    it("setChannelGrantDefault calls the dedicated route, not editChannelGrant", async () => {
        mockClient.setChannelGrantDefault.mockResolvedValue({grant: {}})
        await setChannelGrantDefault("grant-1")
        expect(mockClient.setChannelGrantDefault).toHaveBeenCalledWith(
            {grant_id: "grant-1"},
            expect.anything(),
        )
        expect(mockClient.editChannelGrant).not.toHaveBeenCalled()
    })
})
