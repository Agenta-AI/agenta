// @vitest-environment jsdom
/**
 * Agent sharing around the channels on /m: the Publish panel of a private agent is the same as a
 * shared agent's (a private agent answers in channels), and the privacy dialog learns which
 * channel connections are still off, from the connections Publish already read.
 */
import {act, createElement} from "react"

import type {ChannelConnection, ChannelConnections} from "@agenta/settings-ui"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {publishOptions, dialogProps, workflows, publish} = vi.hoisted(() => ({
    publishOptions: [] as Record<string, unknown>[],
    dialogProps: [] as Record<string, unknown>[],
    workflows: {current: [] as Record<string, unknown>[]},
    publish: {
        openHub: vi.fn(),
        connections: {slack: null, telegram: null, whatsapp: null} as unknown,
    },
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
        agentWorkflowsListQueryStateAtom: mockAtom(() => ({data: workflows.current})),
    }
})

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/shared/state")>()),
        userAtom: mockAtom({id: "me", email: "me@example.com", username: "Me"}),
    }
})

vi.mock("../../src/features/agents/useAgentPublishPanel", () => ({
    useAgentPublishPanel: (options: Record<string, unknown>) => {
        publishOptions.push(options)
        return {
            openHub: publish.openHub,
            reload: vi.fn().mockResolvedValue(undefined),
            connections: publish.connections,
            panel: null,
        }
    },
}))

vi.mock("@agenta/entity-ui/sharing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entity-ui/sharing")>()),
    AgentPrivacyDialog: (props: Record<string, unknown>) => {
        dialogProps.push(props)
        return null
    },
}))

vi.mock("@agenta/entities/sharing", async (importOriginal) => {
    const {atom: mockAtom} = await import("jotai")
    // One atom each: a new atom on every render would subscribe again on every render.
    const query = mockAtom({data: undefined, isPending: false, isError: false, refetch: vi.fn()})
    const members = mockAtom({data: {members: []}, isPending: false, isError: false})
    return {
        ...(await importOriginal<typeof import("@agenta/entities/sharing")>()),
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

vi.mock("../../src/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({data: null}),
}))

vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

import {ShareMenu} from "../../src/features/chat/ShareMenu"

let root: Root | null = null
let host: HTMLDivElement | null = null

const mountShareMenu = () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(
            createElement(
                Provider,
                {store: createStore()},
                createElement(ShareMenu, {
                    agentId: "agent-1",
                    sessionId: "session-1",
                    sessionName: "Refund question",
                    showSession: true,
                    canRequestTemplate: false,
                    workspaceId: "workspace-1",
                    projectId: "project-1",
                    phone: false,
                }),
            ),
        )
    })
}

beforeEach(() => {
    publishOptions.length = 0
    dialogProps.length = 0
    publish.openHub.mockClear()
    publish.connections = {slack: null, telegram: null, whatsapp: null}
})

afterEach(() => {
    act(() => {
        root?.unmount()
        host?.remove()
    })
    root = null
    host = null
})

describe("the Publish panel of a private agent", () => {
    it("gets no private state: a private agent connects like a shared one", () => {
        workflows.current = [
            {
                id: "agent-1",
                name: "Support triage",
                access: {visibility: "private", owner_user_id: "me"},
            },
        ]
        mountShareMenu()
        const options = publishOptions.at(-1)!
        expect(options.agentName).toBe("Support triage")
        expect(options).not.toHaveProperty("agentPrivate")
        expect(options).not.toHaveProperty("onShareAgent")
    })
})

describe("the privacy dialog's channel state", () => {
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
        agentConnections: {slack: rows, telegram: [], whatsapp: []},
        allConnections: rows,
    })
    const render = (rows: ChannelConnection[]) => {
        publish.connections = connections(rows)
        mountShareMenu()
    }

    it("names a platform whose connection is still off", () => {
        render([slack({connectionId: "a", workspaceName: "Acme", agentOff: true})])
        const props = dialogProps.at(-1)!
        expect(props.channelsOff).toEqual(["Slack"])
        expect(props).not.toHaveProperty("channelConnections")
        ;(props.onOpenChannels as () => void)()
        expect(publish.openHub).toHaveBeenCalledTimes(1)
    })

    it("names nothing when every connection answers", () => {
        render([
            slack({connectionId: "a", workspaceName: "Acme"}),
            slack({connectionId: "b", workspaceName: "Beta"}),
        ])
        expect(dialogProps.at(-1)!.channelsOff).toEqual([])
    })
})
