// @vitest-environment jsdom
/**
 * Agent sharing around the channels on /m: the privacy control learns which channel connections
 * are still off, from the connections Publish already read.
 */
import {createElement} from "react"

import type {ChannelConnection, ChannelConnections} from "@agenta/settings-ui"
import {createStore, Provider} from "jotai"
import {renderToStaticMarkup} from "react-dom/server"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {controlProps} = vi.hoisted(() => ({
    controlProps: [] as Record<string, unknown>[],
}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        userAtom: mockAtom({id: "me", email: "me@example.com", username: "Me"}),
    }
})

vi.mock("@agenta/entity-ui/sharing", () => ({
    AgentPrivacyControl: (props: Record<string, unknown>) => {
        controlProps.push(props)
        return null
    },
    AgentPrivacyDialog: () => null,
    sharingWriteResultFromError: () => "failed",
}))

vi.mock("@agenta/entities/sharing", async () => {
    const {atom: mockAtom} = await import("jotai")
    // One atom each: a new atom on every render would subscribe again on every render.
    const query = mockAtom({data: undefined, isPending: false, isError: false, refetch: vi.fn()})
    const members = mockAtom({data: {members: []}, isPending: false, isError: false})
    return {
        agentSharingQueryAtomFamily: () => query,
        sharingMembersQueryAtomFamily: () => members,
        sharingMemberRosterQueryAtom: mockAtom({data: [], isPending: false, isError: false}),
        setAgentVisibilityAtom: mockAtom(null, () => undefined),
        transferAgentAtom: mockAtom(null, () => undefined),
        takeAgentOwnershipAtom: mockAtom(null, () => undefined),
    }
})

vi.mock("../../src/features/context/useCurrentProject", () => ({
    useCurrentProject: () => ({project_name: "Acme support"}),
}))

vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

import {AgentPrivacyHost} from "../../src/features/chat/AgentPrivacyHost"

beforeEach(() => {
    controlProps.length = 0
})

describe("the privacy control's channel state", () => {
    const slack = (over: Partial<ChannelConnection>): ChannelConnection => ({
        platform: "slack",
        kind: "hosted",
        status: "connected",
        dm: "allow",
        group: "allow",
        chats: [],
        agent: {id: "agent-1", name: "Support triage"},
        ...over,
    })
    const connections = (rows: ChannelConnection[]): ChannelConnections => ({
        slack: rows[0] ?? null,
        telegram: null,
        whatsapp: null,
        discord: null,
        teams: null,
        agentConnections: {slack: rows, telegram: [], whatsapp: [], discord: [], teams: []},
        allConnections: rows,
    })
    const render = (rows: ChannelConnection[]) =>
        renderToStaticMarkup(
            createElement(
                Provider,
                {store: createStore()},
                createElement(AgentPrivacyHost, {
                    agentId: "agent-1",
                    agentName: "Support triage",
                    workspaceId: "workspace-1",
                    projectId: "project-1",
                    connections: connections(rows),
                    onOpenChannels: () => undefined,
                }),
            ),
        )

    it("names a platform whose connection is still off", () => {
        render([slack({connectionId: "a", workspaceName: "Acme", agentOff: true})])
        const props = controlProps.at(-1)!
        expect(props.channelsOff).toEqual(["Slack"])
        expect(props).not.toHaveProperty("channelConnections")
        expect(typeof props.onOpenChannels).toBe("function")
    })

    it("names nothing when every connection answers", () => {
        render([
            slack({connectionId: "a", workspaceName: "Acme"}),
            slack({connectionId: "b", workspaceName: "Beta"}),
        ])
        expect(controlProps.at(-1)!.channelsOff).toEqual([])
    })
})
