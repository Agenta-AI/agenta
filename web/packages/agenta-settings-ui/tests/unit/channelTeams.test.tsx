// @vitest-environment jsdom
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => ({
    Alert: ({
        message,
        description,
        ...props
    }: {
        message: string
        description?: React.ReactNode
        "data-testid"?: string
    }) => (
        <div role="alert" data-testid={props["data-testid"]}>
            {message}
            {description}
        </div>
    ),
    SheetFooter: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
    Button: ({children, onClick, disabled, asChild, ...props}: any) =>
        asChild ? (
            children
        ) : (
            <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
                {children}
            </button>
        ),
    Input: (props: React.ComponentProps<"input">) => <input {...props} />,
    InputAffix: (props: React.ComponentProps<"input">) => <input {...props} />,
    Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
    PasswordInput: (props: React.ComponentProps<"input">) => <input {...props} />,
    Spinner: () => <span />,
    Checkbox: () => <input type="checkbox" />,
    RadioGroup: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
    RadioGroupItem: () => <input type="radio" />,
    Switch: (props: {"data-testid"?: string; "aria-label"?: string}) => (
        <button data-testid={props["data-testid"]} aria-label={props["aria-label"]} />
    ),
}))
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/qr", () => ({QrCode: () => null}))

import {
    buildAgentChannelsActions,
    chatTypeOf,
    connectionsForAgent,
    groupKindsOf,
    type ChannelsClientLike,
} from "../../src/channels/actions"
import {ChannelConnectFlow} from "../../src/channels/ChannelConnectFlow"
import {ChannelManagePanel} from "../../src/channels/ChannelManagePanel"
import {
    CHANNEL_PLATFORMS,
    NOOP_ACTIONS,
    base64Bytes,
    connectionRowText,
    summarizeConnection,
} from "../../src/channels/helpers"
import type {
    ChannelConnection,
    ChannelSetupDocument,
    ChannelSetupField,
} from "../../src/channels/types"

const GUID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
const GUID_ERROR = "Enter the ID as a GUID, for example 00000000-0000-0000-0000-000000000000."

const FIELDS: ChannelSetupField[] = [
    {
        name: "app_id",
        label: "Application (client) ID",
        secret: false,
        required: true,
        pattern: GUID,
        patternError: GUID_ERROR,
    },
    {
        name: "client_secret",
        label: "Client secret value",
        secret: true,
        required: true,
        help: "Copy the secret's Value, not its Secret ID.",
    },
    {
        name: "tenant_id",
        label: "Directory (tenant) ID",
        secret: false,
        required: true,
        pattern: GUID,
        patternError: GUID_ERROR,
    },
]

const APP_ID = "11111111-2222-3333-4444-555555555555"
const TENANT_ID = "66666666-7777-8888-9999-000000000000"
const ENDPOINT = "https://agenta.example.com/api/channels/teams/events/"
// "PK" and four more bytes, so the decode is checked byte for byte.
const ZIP_BYTES = [0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]
const PACKAGE: ChannelSetupDocument = {
    format: "zip",
    content: btoa(String.fromCharCode(...ZIP_BYTES)),
    filename: "agenta-teams-app.zip",
    link: null,
}

const CONNECTED: ChannelConnection = {
    connectionId: "teams-1",
    platform: "teams",
    kind: "custom",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [],
    agent: {id: "agent", name: "QA"},
    webhookUrl: ENDPOINT,
}

let root: Root
let container: HTMLDivElement
let saved: {blob: Blob; filename: string}[]
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    // jsdom has no object URLs and does not save files, so record what a click would save.
    saved = []
    const blobs = new Map<string, Blob>()
    URL.createObjectURL = vi.fn((blob: Blob) => {
        const url = `blob:test-${blobs.size}`
        blobs.set(url, blob)
        return url
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement,
    ) {
        const blob = blobs.get(this.href)
        if (blob) saved.push({blob, filename: this.download})
    })
})
afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
})

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)

const type = async (id: string, value: string) => {
    const input = byTestId(id) as HTMLInputElement
    expect(input, id).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === text,
    )
    expect(button, text).toBeTruthy()
    await act(async () => button!.click())
}

const savedBytes = async () => {
    expect(saved).toHaveLength(1)
    // jsdom's Blob has no arrayBuffer(), so read it the old way.
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(saved[0].blob)
    })
    return Array.from(new Uint8Array(buffer))
}

const fillAll = async () => {
    await type("channels-field-app_id", APP_ID)
    await type("channels-field-client_secret", "secret-value")
    await type("channels-field-tenant_id", TENANT_ID)
}

describe("Teams connect flow", () => {
    const renderFlow = async (overrides = {}) => {
        const onConnected = vi.fn()
        const connectCustom = vi.fn().mockResolvedValue(CONNECTED)
        const teamsAppPackage = vi.fn().mockResolvedValue(PACKAGE)
        await act(async () =>
            root.render(
                <ChannelConnectFlow
                    platform="teams"
                    agentName="QA"
                    onConnected={onConnected}
                    actions={{
                        ...NOOP_ACTIONS,
                        loadSetup: async () => ({
                            manifest: null,
                            fields: FIELDS,
                            hostedAvailable: false,
                        }),
                        connectCustom,
                        teamsAppPackage,
                        ...overrides,
                    }}
                />,
            ),
        )
        return {onConnected, connectCustom, teamsAppPackage}
    }

    it("opens on the setup steps and the three fields, with no method choice", async () => {
        await renderFlow()
        expect(byTestId("channels-method")).toBeNull()
        expect(container.textContent).toContain("Register a bot")
        expect(container.textContent).toContain("Add a client secret")
        expect(container.textContent).toContain("Copy your tenant ID")
        expect(container.textContent).toContain("Paste the three values")
        expect(
            container.querySelector('a[href="https://dev.teams.microsoft.com/bots"]'),
        ).toBeTruthy()
        expect(container.querySelector('a[href="https://entra.microsoft.com"]')).toBeTruthy()
        expect(container.textContent).toContain("Application (client) ID")
        expect(container.textContent).toContain("Client secret value")
        expect(container.textContent).toContain("Directory (tenant) ID")
        expect(container.textContent).toContain("Copy the secret's Value, not its Secret ID.")
        expect((byTestId("channels-field-client_secret") as HTMLInputElement).value).toBe("")
    })

    it("refuses an id that is not a GUID before connecting", async () => {
        const {connectCustom} = await renderFlow()
        await fillAll()
        await type("channels-field-app_id", "not-a-guid")
        expect(byTestId("channels-field-app_id-error")?.textContent).toBe(GUID_ERROR)
        expect((byTestId("channels-connect-custom") as HTMLButtonElement).disabled).toBe(true)
        expect(connectCustom).not.toHaveBeenCalled()
    })

    it("connects, then shows the endpoint and the app download before finishing", async () => {
        const {onConnected, connectCustom, teamsAppPackage} = await renderFlow()
        await fillAll()
        await click("Connect bot")

        expect(connectCustom).toHaveBeenCalledWith("teams", {
            app_id: APP_ID,
            client_secret: "secret-value",
            tenant_id: TENANT_ID,
        })
        expect(container.textContent).toContain("Connected. Two steps left in Teams.")
        expect(container.textContent).toContain("Messaging endpoint")
        expect((byTestId("channels-teams-endpoint") as HTMLInputElement).value).toBe(ENDPOINT)
        expect(container.textContent).toContain(
            "In Teams, open Apps, then Manage your apps, then Upload an app, and choose the downloaded file.",
        )
        expect(container.textContent).toContain(
            "No Upload an app option? Ask your Teams admin to allow custom apps.",
        )
        // The package is read on click only.
        expect(teamsAppPackage).not.toHaveBeenCalled()
        expect(onConnected).not.toHaveBeenCalled()

        await click("Download Teams app")
        expect(teamsAppPackage).toHaveBeenCalledWith("teams-1")
        expect(saved[0]?.filename).toBe("agenta-teams-app.zip")
        expect(saved[0]?.blob.type).toBe("application/zip")
        expect(await savedBytes()).toEqual(ZIP_BYTES)

        await click("Done")
        expect(onConnected).toHaveBeenCalledTimes(1)
    })

    it("copies the endpoint", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, "clipboard", {value: {writeText}, configurable: true})
        await renderFlow()
        await fillAll()
        await click("Connect bot")
        await click("Copy")
        expect(writeText).toHaveBeenCalledWith(ENDPOINT)
        expect(container.textContent).toContain("Copied")
    })

    it("shows an error when the package does not load, and saves nothing", async () => {
        await renderFlow({teamsAppPackage: vi.fn().mockResolvedValue(null)})
        await fillAll()
        await click("Connect bot")
        await click("Download Teams app")
        expect(byTestId("channels-teams-download-error")?.textContent).toBe(
            "Could not load the Teams app.",
        )
        expect(saved).toHaveLength(0)
    })

    it("shows why Microsoft refused and keeps the values", async () => {
        const message =
            "Microsoft rejected this client secret. Copy the secret's Value, not its Secret ID."
        const {onConnected} = await renderFlow({
            connectCustom: vi.fn().mockRejectedValue(new Error(message)),
        })
        await fillAll()
        await click("Connect bot")
        expect(container.textContent).toContain(message)
        expect((byTestId("channels-field-app_id") as HTMLInputElement).value).toBe(APP_ID)
        expect(byTestId("channels-teams-endpoint")).toBeNull()
        expect(onConnected).not.toHaveBeenCalled()
    })
})

describe("Teams actions", () => {
    const fixture = () => {
        const client = {
            fetchChannelSetup: vi.fn().mockResolvedValue({
                setup: {fields: FIELDS, hosted_available: false},
            }),
            fetchChannelConnectionSetup: vi.fn().mockResolvedValue({setup: {document: PACKAGE}}),
            createChannelConnection: vi.fn().mockResolvedValue({
                connection: {
                    id: "teams-1",
                    channel: "teams",
                    flags: {is_active: true},
                    data: {
                        connection_locator: {app_id: APP_ID},
                        tenant_id: TENANT_ID,
                        webhook_url: ENDPOINT,
                    },
                },
            }),
            queryChannelAgents: vi.fn().mockResolvedValue({agents: []}),
            createChannelAgent: vi.fn().mockResolvedValue({}),
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

    it("sends the secret as a credential and the ids as data on the teams channel", async () => {
        const {client, actions} = fixture()
        const created = await actions.connectCustom("teams", {
            app_id: APP_ID,
            client_secret: "secret-value",
            tenant_id: TENANT_ID,
        })
        expect(client.createChannelConnection).toHaveBeenCalledWith(
            {
                connection: {
                    channel: "teams",
                    data: {app_id: APP_ID, tenant_id: TENANT_ID},
                    credentials: {client_secret: "secret-value"},
                },
            },
            {queryParams: {project_id: "project-1"}},
        )
        expect(created?.platform).toBe("teams")
        expect(created?.webhookUrl).toBe(ENDPOINT)
    })

    it("reads the package from the connection's setup document, keeping format and filename", async () => {
        const {client, actions} = fixture()
        expect(await actions.teamsAppPackage("teams-1")).toEqual(PACKAGE)
        expect(client.fetchChannelConnectionSetup).toHaveBeenCalledWith(
            {connection_id: "teams-1"},
            {queryParams: {project_id: "project-1"}},
        )
    })

    it("answers in channels and group chats with the group switch, and lists Teams last", () => {
        expect(groupKindsOf("teams")).toEqual(["group", "topic"])
        // A team channel is a channel; a group chat stays a group.
        expect(chatTypeOf("topic", "teams")).toBe("channel")
        expect(chatTypeOf("group", "teams")).toBe("group")
        // One team channel and one group chat count as two chats, not two channels.
        const chats = [
            {name: "General", type: chatTypeOf("topic", "teams")},
            {name: "Launch", type: chatTypeOf("group", "teams")},
        ]
        expect(connectionRowText({...CONNECTED, dm: "off", chats}).detail).toContain("2 chats")
        expect(CHANNEL_PLATFORMS.at(-1)).toBe("teams")
        const out = connectionsForAgent([CONNECTED], "agent")
        expect(out.teams).toBe(CONNECTED)
        expect(out.agentConnections?.teams).toEqual([CONNECTED])
    })

    it("decodes base64 byte for byte, ignoring line breaks", () => {
        const wrapped = `${PACKAGE.content!.slice(0, 4)}\n${PACKAGE.content!.slice(4)}`
        expect(Array.from(base64Bytes(wrapped))).toEqual(ZIP_BYTES)
    })
})

describe("Teams row summary", () => {
    it("offers to connect when nothing is connected", () => {
        const row = summarizeConnection("teams", null, "agent")
        expect(row.action).toBe("connect")
        expect(row.sub).toBe("Chat with the agent in Microsoft Teams")
    })

    it("asks for a new secret when Microsoft rejected it", () => {
        const row = summarizeConnection("teams", {...CONNECTED, status: "revoked"}, "agent")
        expect(row.sub).toBe("Client secret rejected · update it")
        expect(row.needsAttention).toBe(true)
    })
})

describe("Teams manage panel", () => {
    const renderPanel = async (connection: ChannelConnection, overrides = {}) =>
        act(async () =>
            root.render(
                <ChannelManagePanel
                    agentName="QA"
                    agentId="agent"
                    connection={connection}
                    onConnectHere={async () => {}}
                    onDisconnect={async () => {}}
                    actions={{
                        ...NOOP_ACTIONS,
                        teamsAppPackage: async () => PACKAGE,
                        ...overrides,
                    }}
                />,
            ),
        )

    it("shows the endpoint again and offers the download", async () => {
        await renderPanel(CONNECTED)
        expect(container.textContent).toContain("Teams app")
        expect((byTestId("channels-teams-endpoint") as HTMLInputElement).value).toBe(ENDPOINT)
        expect(container.textContent).toContain("Channels and group chats")
        expect(container.textContent).not.toContain("Channels it’s in")
        await click("Download Teams app")
        expect(await savedBytes()).toEqual(ZIP_BYTES)
    })

    it("asks for a new client secret when Microsoft rejected it", async () => {
        await renderPanel({...CONNECTED, status: "revoked"})
        expect(container.textContent).toContain("Microsoft rejected the client secret")
        expect(container.textContent).toContain(
            "QA cannot answer there until you paste a new client secret.",
        )
        expect(container.textContent).not.toContain("BotFather")
    })
})
