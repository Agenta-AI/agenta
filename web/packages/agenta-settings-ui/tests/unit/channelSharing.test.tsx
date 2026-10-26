// @vitest-environment jsdom
/**
 * Agent sharing in the channel UI (M3 design section 5): the agent step's audience note and
 * private rows, the Publish hub of a private agent, the manage panel of a connection that
 * make-private turned off, and the server's private-agent refusal.
 */
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => {
    const Wrap = ({children}: {children?: React.ReactNode}) => <div>{children}</div>
    return {
        Alert: ({
            message,
            action,
            ...props
        }: {
            message: React.ReactNode
            action?: React.ReactNode
            "data-testid"?: string
        }) => (
            <div role="alert" data-testid={props["data-testid"]}>
                {message}
                {action}
            </div>
        ),
        cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
        SheetFooter: Wrap,
        Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
            <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
                {children}
            </button>
        ),
        Input: (props: React.ComponentProps<"input">) => <input {...props} />,
        PasswordInput: () => <input />,
        RadioGroup: Wrap,
        RadioGroupItem: () => <span />,
        Select: Wrap,
        SelectContent: Wrap,
        SelectItem: Wrap,
        SelectTrigger: Wrap,
        SelectValue: () => null,
        SkeletonBlock: () => <span />,
        Spinner: () => <span />,
        Switch: () => <span />,
        Checkbox: () => <input type="checkbox" />,
        Accordion: Wrap,
        AccordionContent: Wrap,
        AccordionItem: Wrap,
        AccordionTrigger: Wrap,
    }
})
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/AgentMark", () => ({AgentMark: () => null}))

import {
    ChannelAgentPrivateError,
    buildAgentChannelsActions,
    isPrivateAgentRefusal,
    type ChannelsClientLike,
} from "../../src/channels/actions"
import {ChannelAgentPicker} from "../../src/channels/ChannelAgentPicker"
import {ChannelManagePanel} from "../../src/channels/ChannelManagePanel"
import {ChannelsHubView} from "../../src/channels/ChannelsHubView"
import {EMPTY_CONNECTIONS, NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelConnection} from "../../src/channels/types"

let root: Root
let container: HTMLDivElement
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
})
afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
})

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const render = async (node: React.ReactNode) => act(async () => root.render(node))

describe("ChannelAgentPicker", () => {
    const agents = [
        {id: "mine-private", name: "Recruiting helper", isPrivate: true},
        {id: "shared", name: "Support triage"},
    ]

    it("disables private agents and lists them last", async () => {
        const onSelect = vi.fn()
        const onShareAgent = vi.fn()
        await render(
            <ChannelAgentPicker
                agents={agents}
                connections={EMPTY_CONNECTIONS}
                onSelect={onSelect}
                platform="slack"
                projectName="Acme support"
                onShareAgent={onShareAgent}
            />,
        )
        const rows = [...container.querySelectorAll('[data-testid^="channels-agent-"]')].filter(
            (row) =>
                /^channels-agent-(shared|mine-private)$/.test(row.getAttribute("data-testid")!),
        )
        expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
            "channels-agent-shared",
            "channels-agent-mine-private",
        ])

        const privateRow = byTestId("channels-agent-mine-private")!
        expect(privateRow.tagName).not.toBe("BUTTON")
        expect(privateRow.getAttribute("aria-disabled")).toBe("true")
        expect(privateRow.textContent).toContain(
            "Private. Share it with the project to use it in Slack.",
        )
        await act(async () => privateRow.click())
        expect(onSelect).not.toHaveBeenCalled()

        await act(async () => byTestId("channels-agent-share-mine-private")!.click())
        expect(onShareAgent).toHaveBeenCalledWith("mine-private")

        await act(async () => byTestId("channels-agent-shared")!.click())
        expect(onSelect).toHaveBeenCalledWith("shared")
    })

    it("shows the audience note for the project", async () => {
        await render(
            <ChannelAgentPicker
                agents={agents}
                connections={EMPTY_CONNECTIONS}
                onSelect={() => undefined}
                platform="slack"
                projectName="Acme support"
            />,
        )
        expect(byTestId("channels-picker-audience")?.textContent).toBe(
            "Everyone in Acme support can read the agent's Slack conversations in Agenta, including direct messages.",
        )
        // No share link without a host that opens "Privacy and owner".
        expect(byTestId("channels-agent-share-mine-private")).toBeNull()
    })
})

describe("ChannelsHubView of a private agent", () => {
    it("shows the private note in place of the connect buttons", async () => {
        const onShareAgent = vi.fn()
        await render(
            <ChannelsHubView
                agentId="agent"
                connections={EMPTY_CONNECTIONS}
                onRetry={async () => undefined}
                showApi={false}
                apiLive={false}
                onOpenPlatform={() => undefined}
                onOpenConnection={() => undefined}
                onAdd={() => undefined}
                onOpenApi={() => undefined}
                agentPrivate
                onShareAgent={onShareAgent}
            />,
        )
        expect(byTestId("channels-hub-private")?.textContent).toContain(
            "Private agents cannot answer in Slack, Telegram and WhatsApp. Share this agent with the project to connect it.",
        )
        expect(byTestId("channels-hub-add-slack")).toBeNull()
        expect((byTestId("channels-hub-slack") as HTMLButtonElement).disabled).toBe(true)
        await act(async () => byTestId("channels-hub-share-agent")!.click())
        expect(onShareAgent).toHaveBeenCalledTimes(1)
    })

    it("keeps the connect buttons for a shared agent", async () => {
        await render(
            <ChannelsHubView
                agentId="agent"
                connections={EMPTY_CONNECTIONS}
                onRetry={async () => undefined}
                showApi={false}
                apiLive={false}
                onOpenPlatform={() => undefined}
                onOpenConnection={() => undefined}
                onAdd={() => undefined}
                onOpenApi={() => undefined}
            />,
        )
        expect(byTestId("channels-hub-private")).toBeNull()
        expect(byTestId("channels-hub-add-slack")).not.toBeNull()
    })
})

describe("ChannelManagePanel after make-private", () => {
    const offSlack: ChannelConnection = {
        platform: "slack",
        kind: "hosted",
        status: "connected",
        connectionId: "slack-1",
        workspaceName: "Acme workspace",
        agent: {id: "agent", name: "Support triage"},
        agentOff: true,
        dm: "allow",
        group: "allow",
        chats: [],
    }
    const listSpaces = async () => [
        {id: "dm", kind: "private" as const, name: "Direct messages"},
        {id: "c1", kind: "topic" as const, name: "support"},
        {id: "c2", kind: "topic" as const, name: "billing-help"},
    ]
    const panel = (props: Partial<React.ComponentProps<typeof ChannelManagePanel>>) => (
        <ChannelManagePanel
            agentName="Support triage"
            agentId="agent"
            connection={offSlack}
            onConnectHere={async () => {}}
            onDisconnect={async () => {}}
            actions={{...NOOP_ACTIONS, listSpaces}}
            {...props}
        />
    )

    it("says why it is off and keeps Turn on disabled while the agent is private", async () => {
        const onShareAgent = vi.fn()
        await render(panel({agentPrivate: true, onShareAgent, onTurnOn: vi.fn()}))
        expect(byTestId("channels-off-private")?.textContent).toContain(
            "This agent is private, so its Slack connection is off.",
        )
        const off = byTestId("channels-off")!.textContent
        expect(off).toContain("Slack · Acme workspace")
        expect(off).toContain("Off · in #support and #billing-help")
        expect((byTestId("channels-turn-on") as HTMLButtonElement).disabled).toBe(true)
        await act(async () => byTestId("channels-off-share")!.click())
        expect(onShareAgent).toHaveBeenCalledTimes(1)
    })

    it("enables Turn on once the agent is shared again, without the private note", async () => {
        const onTurnOn = vi.fn().mockResolvedValue(undefined)
        await render(panel({agentPrivate: false, onTurnOn}))
        expect(byTestId("channels-off-private")).toBeNull()
        const turnOn = byTestId("channels-turn-on") as HTMLButtonElement
        expect(turnOn.disabled).toBe(false)
        await act(async () => turnOn.click())
        expect(onTurnOn).toHaveBeenCalledTimes(1)
    })

    it("shows the server refusal when the agent became private again", async () => {
        const onTurnOn = vi.fn().mockRejectedValue(new ChannelAgentPrivateError("slack"))
        await render(panel({agentPrivate: false, onTurnOn}))
        await act(async () => byTestId("channels-turn-on")!.click())
        expect(container.textContent).toContain(
            "This agent is private now, so it cannot answer in Slack.",
        )
    })

    it("shows no off block for a binding that is on", async () => {
        await render(panel({connection: {...offSlack, agentOff: false}, agentPrivate: false}))
        expect(byTestId("channels-off")).toBeNull()
    })
})

describe("channel actions and the private-agent refusal", () => {
    const refusal = {statusCode: 404, body: {detail: {code: "not_found", message: "Not found."}}}
    const binding = (flags: Record<string, unknown>) => ({
        id: "binding-1",
        flags,
        data: {references: {application: {id: "app-1"}}},
    })
    const fixture = () => {
        const client = {
            queryChannelConnections: vi.fn().mockResolvedValue({
                connections: [{id: "slack-1", channel: "slack", flags: {is_active: true}}],
            }),
            queryChannelAgents: vi
                .fn()
                .mockResolvedValue({agents: [binding({is_default: true, is_active: false})]}),
            queryChannelSpaces: vi.fn().mockResolvedValue({spaces: []}),
            editChannelAgent: vi.fn().mockResolvedValue({}),
            createChannelAgent: vi.fn().mockResolvedValue({}),
            createTelegramHostedBindLink: vi.fn().mockRejectedValue(refusal),
        }
        const actions = buildAgentChannelsActions({
            client: client as unknown as ChannelsClientLike,
            projectId: () => "project-1",
            appId: "app-1",
            resolveAgentName: () => "Support triage",
            hostedSlackInstallUrl: () => null,
        })
        return {client, actions}
    }

    it("reads the canonical 404 as a private-agent refusal, and nothing else", () => {
        expect(isPrivateAgentRefusal(refusal)).toBe(true)
        expect(
            isPrivateAgentRefusal({statusCode: 404, body: {detail: "Connection not found"}}),
        ).toBe(false)
        expect(isPrivateAgentRefusal({statusCode: 403, body: {detail: {code: "not_found"}}})).toBe(
            false,
        )
    })

    it("marks a connection whose binding is off", async () => {
        const {actions} = fixture()
        const next = await actions.reload()
        expect(next.slack?.agentOff).toBe(true)
        expect(next.slack?.status).toBe("connected")
    })

    it("turns the binding on with its references and stored flags", async () => {
        const {client, actions} = fixture()
        await actions.turnOn("slack", "slack-1")
        expect(client.editChannelAgent).toHaveBeenCalledWith(
            {
                agent_id: "binding-1",
                agent: {
                    id: "binding-1",
                    data: {references: {application: {id: "app-1"}}},
                    flags: {is_default: true, is_active: true},
                },
            },
            {queryParams: {project_id: "project-1"}},
        )
    })

    it("shows the private text when setup or Turn on is refused", async () => {
        const {client, actions} = fixture()
        client.editChannelAgent.mockRejectedValue(refusal)
        await expect(actions.turnOn("slack", "slack-1")).rejects.toThrow(
            "This agent is private now, so it cannot answer in Slack.",
        )
        client.queryChannelAgents.mockResolvedValue({agents: [binding({is_default: true})]})
        client.queryChannelAgents.mockResolvedValueOnce({
            agents: [{...binding({}), data: {references: {application: {id: "other"}}}}],
        })
        await expect(actions.connectHere("slack", "slack-1")).rejects.toBeInstanceOf(
            ChannelAgentPrivateError,
        )
        await expect(actions.connectHostedTelegram()).rejects.toThrow(
            "This agent is private now, so it cannot answer in Telegram.",
        )
    })
})
