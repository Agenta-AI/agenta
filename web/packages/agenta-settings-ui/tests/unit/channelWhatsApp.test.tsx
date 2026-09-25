// @vitest-environment jsdom
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => ({
    Alert: ({message, description}: {message: string; description?: React.ReactNode}) => (
        <div role="alert">
            {message}
            {description}
        </div>
    ),
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
    Segmented: () => <div data-testid="mode-switch" />,
    Switch: (props: {"data-testid"?: string; "aria-label"?: string}) => (
        <button data-testid={props["data-testid"]} aria-label={props["aria-label"]} />
    ),
}))
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/qr", () => ({QrCode: () => null}))

import {buildAgentChannelsActions, type ChannelsClientLike} from "../../src/channels/actions"
import {ChannelConnectFlow} from "../../src/channels/ChannelConnectFlow"
import {ChannelManagePanel} from "../../src/channels/ChannelManagePanel"
import {NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelConnection, ChannelSetupField} from "../../src/channels/types"

const FIELDS: ChannelSetupField[] = [
    {
        name: "phone_number_id",
        label: "Phone number ID",
        secret: false,
        required: true,
        pattern: "^\\d+$",
    },
    {name: "access_token", label: "Access token", secret: true, required: true},
    {name: "app_secret", label: "App secret", secret: true, required: true},
    {name: "reopen_template", label: "Re-open template (optional)", secret: false, required: false},
    {
        name: "reopen_template_language",
        label: "Template language (optional)",
        secret: false,
        required: false,
    },
]

const WEBHOOK_URL = "https://agenta.example/api/channels/whatsapp/events/"
const VERIFY_TOKEN = "verify-token-123"

const CONNECTED: ChannelConnection = {
    connectionId: "wa-1",
    platform: "whatsapp",
    kind: "custom",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [],
    agent: {id: "agent", name: "QA"},
    handle: "+1 555 0100",
    webhookUrl: WEBHOOK_URL,
    webhookVerifyToken: VERIFY_TOKEN,
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {writeText: vi.fn().mockResolvedValue(undefined)},
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

describe("WhatsApp connect flow", () => {
    const renderFlow = async (overrides = {}) => {
        const onConnected = vi.fn()
        const connectCustom = vi.fn().mockResolvedValue(CONNECTED)
        await act(async () =>
            root.render(
                <ChannelConnectFlow
                    platform="whatsapp"
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
                        ...overrides,
                    }}
                />,
            ),
        )
        return {onConnected, connectCustom}
    }

    it("opens straight on the paste form with every declared field", async () => {
        await renderFlow()
        expect(byTestId("mode-switch")).toBeNull()
        for (const field of FIELDS) {
            expect(byTestId(`channels-field-${field.name}`), field.name).toBeTruthy()
        }
        const link = container.querySelector('a[href="https://developers.facebook.com/apps"]')
        expect(link).toBeTruthy()
    })

    it("shows the billing notice and no policy checkbox", async () => {
        await renderFlow()
        expect(container.textContent).toContain(
            "Meta bills your business directly for WhatsApp messages.",
        )
        expect(
            container.querySelector(
                'a[href="https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing"]',
            ),
        ).toBeTruthy()
        expect(container.querySelector('input[type="checkbox"]')).toBeNull()
        expect(container.textContent?.toLowerCase()).not.toContain("policy")
    })

    it("connects, then shows the callback URL and verify token before finishing", async () => {
        const {onConnected, connectCustom} = await renderFlow()
        await type("channels-field-phone_number_id", "1234567890")
        await type("channels-field-access_token", "EAAG-token")
        await type("channels-field-app_secret", "app-secret")
        await click("Connect to WhatsApp")

        expect(connectCustom).toHaveBeenCalledWith("whatsapp", {
            phone_number_id: "1234567890",
            access_token: "EAAG-token",
            app_secret: "app-secret",
        })
        expect((byTestId("channels-whatsapp-webhook-url") as HTMLInputElement | null)?.value).toBe(
            WEBHOOK_URL,
        )
        expect((byTestId("channels-whatsapp-verify-token") as HTMLInputElement | null)?.value).toBe(
            VERIFY_TOKEN,
        )
        expect(container.textContent).toContain("messages")
        expect(onConnected).not.toHaveBeenCalled()

        await click("Done")
        expect(onConnected).toHaveBeenCalledTimes(1)
    })

    it("shows why Meta refused, in view, and keeps the form", async () => {
        const scrolled = vi.fn()
        Element.prototype.scrollIntoView = scrolled
        const refusal =
            "This token can't send messages from this number. In Meta Business Settings → " +
            "System users → <user>, assign the WhatsApp account with Full control."
        const {onConnected} = await renderFlow({
            connectCustom: vi.fn().mockRejectedValue(new Error(refusal)),
        })
        await type("channels-field-phone_number_id", "1234567890")
        await type("channels-field-access_token", "EAAG-token")
        await type("channels-field-app_secret", "app-secret")
        await click("Connect to WhatsApp")

        const alert = container.querySelector('[role="alert"]')
        expect(alert?.textContent).toContain(refusal)
        // The form is long: the error sits above it, so it is scrolled into view.
        expect(scrolled).toHaveBeenCalled()
        expect(byTestId("channels-field-access_token")).toBeTruthy()
        expect(onConnected).not.toHaveBeenCalled()
    })
})

describe("WhatsApp actions", () => {
    const fixture = () => {
        const client = {
            fetchChannelSetup: vi.fn().mockResolvedValue({
                setup: {
                    fields: FIELDS.map((field) => ({
                        ...field,
                        pattern: field.pattern ?? null,
                    })),
                    hosted_available: false,
                },
            }),
            createChannelConnection: vi.fn().mockResolvedValue({
                connection: {
                    id: "wa-1",
                    channel: "whatsapp",
                    flags: {is_active: true},
                    data: {
                        phone_number_id: "1234567890",
                        display_phone_number: "+1 555 0100",
                        verified_name: "Acme",
                        webhook_url: WEBHOOK_URL,
                        webhook_verify_token: VERIFY_TOKEN,
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

    it("sends the number id as data and the token and app secret as credentials", async () => {
        const {client, actions} = fixture()
        const created = await actions.connectCustom("whatsapp", {
            phone_number_id: "1234567890",
            access_token: "EAAG-token",
            app_secret: "app-secret",
            reopen_template: "reopen",
        })
        expect(client.createChannelConnection).toHaveBeenCalledWith(
            {
                connection: {
                    channel: "whatsapp",
                    data: {phone_number_id: "1234567890", reopen_template: "reopen"},
                    credentials: {access_token: "EAAG-token", app_secret: "app-secret"},
                },
            },
            {queryParams: {project_id: "project-1"}},
        )
        expect(created?.platform).toBe("whatsapp")
        expect(created?.webhookUrl).toBe(WEBHOOK_URL)
        expect(created?.webhookVerifyToken).toBe(VERIFY_TOKEN)
        expect(created?.handle).toBe("+1 555 0100")
    })
})

describe("WhatsApp manage panel", () => {
    const renderPanel = async (overrides = {}) =>
        act(async () =>
            root.render(
                <ChannelManagePanel
                    agentName="QA"
                    agentId="agent"
                    connection={CONNECTED}
                    onConnectHere={async () => {}}
                    onDisconnect={async () => {}}
                    actions={{...NOOP_ACTIONS, ...overrides}}
                />,
            ),
        )

    it("shows the callback URL and verify token, and no Telegram-only sections", async () => {
        const readAllowedUsers = vi.fn().mockResolvedValue([])
        await renderPanel({readAllowedUsers})
        expect((byTestId("channels-whatsapp-webhook-url") as HTMLInputElement | null)?.value).toBe(
            WEBHOOK_URL,
        )
        expect((byTestId("channels-whatsapp-verify-token") as HTMLInputElement | null)?.value).toBe(
            VERIFY_TOKEN,
        )
        expect(container.textContent).not.toContain("Allowed users")
        expect(container.textContent).not.toContain("Telegram")
        expect(byTestId("channels-behavior-group")).toBeNull()
        expect(readAllowedUsers).not.toHaveBeenCalled()
    })

    it("replaces the access token and app secret", async () => {
        await renderPanel({
            loadSetup: async () => ({manifest: null, fields: [], hostedAvailable: false}),
        })
        await act(async () => (byTestId("channels-update-token") as HTMLButtonElement).click())
        expect(byTestId("channels-token-access_token")).toBeTruthy()
        expect(byTestId("channels-token-app_secret")).toBeTruthy()
    })
})
