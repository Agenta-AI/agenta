// @vitest-environment jsdom
/**
 * Agent sharing in the channel UI: a private agent answers in channels like a shared one
 * (owner ruling 2026-10-26). The agent step lists every agent and states who reads the
 * conversations; the Publish hub of a private agent keeps its connect buttons; an off
 * binding can always be turned back on.
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

import {buildAgentChannelsActions, type ChannelsClientLike} from "../../src/channels/actions"
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
        {id: "mine-private", name: "Recruiting helper"},
        {id: "shared", name: "Support triage"},
    ]

    it("lets the reader pick any agent it lists, a private one included", async () => {
        const onSelect = vi.fn()
        await render(
            <ChannelAgentPicker
                agents={agents}
                connections={EMPTY_CONNECTIONS}
                onSelect={onSelect}
                platform="slack"
                projectName="Acme support"
            />,
        )
        const privateRow = byTestId("channels-agent-mine-private")!
        expect(privateRow.tagName).toBe("BUTTON")
        await act(async () => privateRow.click())
        expect(onSelect).toHaveBeenCalledWith("mine-private")
    })

    it("states who reads the conversations, for a shared and for a private agent", async () => {
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
            "For a shared agent, everyone in Acme support can read its Slack conversations in Agenta, including direct messages. For a private agent, new conversations are private to its owner.",
        )
    })
})

describe("ChannelsHubView", () => {
    it("keeps the connect buttons", async () => {
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
        expect(byTestId("channels-hub-add-slack")).not.toBeNull()
        expect((byTestId("channels-hub-slack") as HTMLButtonElement).disabled).toBe(false)
    })
})

describe("ChannelManagePanel of an off binding", () => {
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

    it("lists where it is off and turns it on", async () => {
        const onTurnOn = vi.fn().mockResolvedValue(undefined)
        await render(panel({onTurnOn}))
        const off = byTestId("channels-off")!.textContent
        expect(off).toContain("Slack · Acme workspace")
        expect(off).toContain("Off · in #support and #billing-help")
        const turnOn = byTestId("channels-turn-on") as HTMLButtonElement
        expect(turnOn.disabled).toBe(false)
        await act(async () => turnOn.click())
        expect(onTurnOn).toHaveBeenCalledTimes(1)
    })

    it("shows the server's error when Turn on is refused", async () => {
        const onTurnOn = vi.fn().mockRejectedValue(new Error("Not found."))
        await render(panel({onTurnOn}))
        await act(async () => byTestId("channels-turn-on")!.click())
        expect(container.textContent).toContain("Not found.")
    })

    it("shows no off block for a binding that is on", async () => {
        await render(panel({connection: {...offSlack, agentOff: false}}))
        expect(byTestId("channels-off")).toBeNull()
    })
})

describe("channel actions", () => {
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

    it("passes a refusal on with the server's message, naming no privacy rule", async () => {
        const {client, actions} = fixture()
        client.editChannelAgent.mockRejectedValue(refusal)
        await expect(actions.turnOn("slack", "slack-1")).rejects.toThrow("Not found.")
        await expect(actions.connectHostedTelegram()).rejects.toThrow("Not found.")
    })
})
