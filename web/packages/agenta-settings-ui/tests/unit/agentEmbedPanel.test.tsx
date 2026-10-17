// @vitest-environment jsdom
import React, {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => {
    const Button = ({
        children,
        onClick,
        disabled,
        loading: _loading,
        ...rest
    }: React.ComponentProps<"button"> & {loading?: boolean; variant?: string; size?: string}) => {
        const {variant: _v, size: _s, ...props} = rest as Record<string, unknown>
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                {...(props as React.ComponentProps<"button">)}
            >
                {children}
            </button>
        )
    }
    return {
        Alert: ({message}: {message: React.ReactNode}) => <div role="alert">{message}</div>,
        Button,
        LoadingButton: Button,
        Input: (props: React.ComponentProps<"input">) => <input {...props} />,
        Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
        SkeletonBlock: () => <div />,
        SheetFooter: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
        Select: () => null,
        SelectContent: () => null,
        SelectItem: () => null,
        SelectTrigger: () => null,
        SelectValue: () => null,
        Segmented: ({
            options,
            onChange,
        }: {
            options: {value: string; label: string}[]
            onChange: (value: string) => void
        }) => (
            <div>
                {options.map((option) => (
                    <button key={option.value} role="tab" onClick={() => onChange(option.value)}>
                        {option.label}
                    </button>
                ))}
            </div>
        ),
    }
})

import {useChannelPanel, type ChannelsPanelRenderProps} from "../../src/channels/useChannelPanel"
import {AgentEmbedPanel, type AgentEmbedPanelProps} from "../../src/publish/AgentEmbedPanel"
import {
    createEmbed,
    listAgentEmbeds,
    mapEmbedRow,
    parseOrigins,
    saveEmbed,
    type EmbedClient,
} from "../../src/publish/embedApi"

const SCOPE = {queryParams: {project_id: "proj-1"}}

const embedRow = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    channel: "embed",
    name: `Widget ${id}`,
    data: {
        connection_locator: {embed: `pub-${id}`},
        allowed_origins: "https://a.example\nhttps://b.example",
        appearance: {greeting: "Hi", starters: ["One"], theme: "dark", accent: "#123456"},
    },
    ...extra,
})

const agentFor = (appId: string) => ({
    id: `ca-${appId}`,
    flags: {is_default: true},
    data: {references: {application: {id: appId}}},
})

const makeClient = (overrides: Partial<Record<keyof EmbedClient, unknown>> = {}) => {
    const client = {
        queryChannelConnections: vi.fn(async () => ({
            connections: [
                embedRow("e1"),
                embedRow("e2"),
                embedRow("gone", {deleted_at: "2026-01-01"}),
                {id: "s1", channel: "slack", data: {}},
            ],
        })),
        queryChannelAgents: vi.fn(async ({agent}: {agent: {connection_id: string}}) => ({
            agents: [agentFor(agent.connection_id === "e2" ? "other-agent" : "agent-1")],
        })),
        createChannelAgent: vi.fn(async () => ({})),
        editChannelAgent: vi.fn(async () => ({})),
        createChannelConnection: vi.fn(async () => ({connection: {id: "new-1"}})),
        editChannelConnection: vi.fn(async () => ({})),
        archiveChannelConnection: vi.fn(async () => ({})),
        fetchChannelConnectionSetup: vi.fn(async () => ({
            setup: {document: {content: '<iframe src="https://web/m/embed/pub-e1"></iframe>'}},
        })),
        ...overrides,
    }
    return client as typeof client & EmbedClient
}

describe("embedApi", () => {
    it("lists only live embeds that answer as the agent", async () => {
        const client = makeClient()
        const embeds = await listAgentEmbeds(client, SCOPE, "agent-1")
        expect(embeds.map((embed) => embed.id)).toEqual(["e1"])
        expect(client.queryChannelConnections).toHaveBeenCalledWith(
            {connection: {channel: "embed"}},
            SCOPE,
        )
        expect(embeds[0]).toMatchObject({
            embedId: "pub-e1",
            name: "Widget e1",
            origins: "https://a.example\nhttps://b.example",
            appearance: {greeting: "Hi", starters: ["One"], theme: "dark", accent: "#123456"},
        })
    })

    it("reads origins stored as a list and defaults the theme", () => {
        const embed = mapEmbedRow({
            id: "x",
            data: {connection_locator: {embed: "p"}, allowed_origins: ["https://a", "https://b"]},
        })
        expect(embed?.origins).toBe("https://a\nhttps://b")
        expect(embed?.appearance.theme).toBe("system")
    })

    it("checks origins like the API does", () => {
        expect(parseOrigins("").error).toBe("Add at least one origin.")
        expect(parseOrigins("https://a.example/path").error).toContain("is not an origin")
        expect(parseOrigins(" https://a.example\nhttp://localhost:5173 ")).toEqual({
            origins: ["https://a.example", "http://localhost:5173"],
            error: null,
        })
    })

    it("creates an embed and points it at the agent", async () => {
        const client = makeClient({queryChannelAgents: vi.fn(async () => ({agents: []}))})
        const id = await createEmbed(client, SCOPE, "agent-1", {
            name: " Help ",
            origins: "https://a.example",
        })
        expect(id).toBe("new-1")
        expect(client.createChannelConnection).toHaveBeenCalledWith(
            {
                connection: {
                    channel: "embed",
                    name: "Help",
                    data: {allowed_origins: "https://a.example"},
                },
            },
            SCOPE,
        )
        expect(client.createChannelAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                agent: expect.objectContaining({
                    connection_id: "new-1",
                    data: {references: {application: {id: "agent-1"}}},
                }),
            }),
            SCOPE,
        )
    })

    it("archives the new embed when the agent cannot be bound", async () => {
        const client = makeClient({
            queryChannelAgents: vi.fn(async () => ({agents: []})),
            createChannelAgent: vi.fn(async () => {
                throw new Error("nope")
            }),
        })
        await expect(
            createEmbed(client, SCOPE, "agent-1", {name: "", origins: "https://a.example"}),
        ).rejects.toThrow("nope")
        expect(client.archiveChannelConnection).toHaveBeenCalledWith(
            {connection_id: "new-1"},
            SCOPE,
        )
    })

    it("saves the appearance without empty starters", async () => {
        const client = makeClient()
        await saveEmbed(client, SCOPE, {
            id: "e1",
            name: "Help",
            origins: "https://a.example",
            appearance: {
                avatarUrl: "",
                greeting: " Hello ",
                starters: ["A", " ", "B", ""],
                theme: "light",
                accent: "#fff",
            },
        })
        expect(client.editChannelConnection).toHaveBeenCalledWith(
            {
                connection_id: "e1",
                connection: {
                    id: "e1",
                    name: "Help",
                    data: {
                        allowed_origins: "https://a.example",
                        appearance: {
                            avatar_url: null,
                            greeting: "Hello",
                            starters: ["A", "B"],
                            theme: "light",
                            accent: "#fff",
                        },
                    },
                },
            },
            SCOPE,
        )
    })
})

describe("AgentEmbedPanel", () => {
    let root: Root
    let container: HTMLDivElement
    let queryClient: QueryClient
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement("div")
        document.body.append(container)
        root = createRoot(container)
        queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        document.body.innerHTML = ""
    })

    const render = async (element: React.ReactNode) => {
        await act(async () =>
            root.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>),
        )
        // Let the list, then the snippet, settle.
        for (let i = 0; i < 3; i++) {
            await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
        }
    }
    const panel = (client: EmbedClient, props: Partial<AgentEmbedPanelProps> = {}) => (
        <AgentEmbedPanel
            client={client}
            projectId="proj-1"
            agentId="agent-1"
            agentName="Helper"
            connectionId={null}
            onOpen={vi.fn()}
            onBack={vi.fn()}
            widgetUrl={(embedId) => `https://web/m/embed/${embedId}`}
            {...props}
        />
    )
    const byTestId = (id: string) =>
        document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
    const type = async (el: HTMLElement | null, value: string) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement
        const proto = Object.getPrototypeOf(input)
        await act(async () => {
            Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value)
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
    }
    const click = async (el: HTMLElement | null) => {
        expect(el).not.toBeNull()
        await act(async () => el?.click())
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    }

    it("lists the agent's embeds and opens one", async () => {
        const onOpen = vi.fn()
        await render(panel(makeClient(), {onOpen}))
        expect(byTestId("agent-embed-e1")?.textContent).toContain("Widget e1")
        expect(byTestId("agent-embed-e2")).toBeNull()
        await click(byTestId("agent-embed-e1"))
        expect(onOpen).toHaveBeenCalledWith("e1")
    })

    it("refuses a bad origin, then creates and opens the embed", async () => {
        const client = makeClient()
        const onOpen = vi.fn()
        await render(panel(client, {onOpen}))
        await type(byTestId("agent-embed-new-origins"), "tool.example.com")
        await click(byTestId("agent-embed-create"))
        expect(document.querySelector('[role="alert"]')?.textContent).toContain("is not an origin")
        expect(client.createChannelConnection).not.toHaveBeenCalled()

        await type(byTestId("agent-embed-new-origins"), "https://tool.example.com")
        await click(byTestId("agent-embed-create"))
        expect(client.createChannelConnection).toHaveBeenCalledWith(
            {
                connection: {
                    channel: "embed",
                    name: "Helper",
                    data: {allowed_origins: "https://tool.example.com"},
                },
            },
            SCOPE,
        )
        expect(onOpen).toHaveBeenCalledWith("new-1")
    })

    it("edits the greeting, shows the snippet and the preview", async () => {
        const client = makeClient()
        await render(panel(client, {connectionId: "e1"}))
        expect(byTestId("agent-embed-snippet")?.textContent).toContain("pub-e1")
        expect(byTestId("agent-embed-preview")?.getAttribute("src")).toBe(
            "https://web/m/embed/pub-e1",
        )
        expect((byTestId("agent-embed-save") as HTMLButtonElement).disabled).toBe(true)

        await type(byTestId("agent-embed-greeting"), "Welcome")
        await type(byTestId("agent-embed-starter-1"), "Two")
        await click(byTestId("agent-embed-save"))
        expect(client.editChannelConnection).toHaveBeenCalledWith(
            expect.objectContaining({
                connection: expect.objectContaining({
                    data: expect.objectContaining({
                        appearance: expect.objectContaining({
                            greeting: "Welcome",
                            starters: ["One", "Two"],
                            theme: "dark",
                        }),
                    }),
                }),
            }),
            SCOPE,
        )
    })

    it("keeps an edit made while a save is in flight unsaved", async () => {
        let finish: () => void = () => undefined
        const client = makeClient({
            editChannelConnection: vi.fn(
                () => new Promise<object>((resolve) => (finish = () => resolve({}))),
            ),
        })
        await render(panel(client, {connectionId: "e1"}))
        await type(byTestId("agent-embed-greeting"), "A")
        await click(byTestId("agent-embed-save"))
        await type(byTestId("agent-embed-greeting"), "B")
        await act(async () => finish())
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
        expect((byTestId("agent-embed-save") as HTMLButtonElement).disabled).toBe(false)
    })

    it("refuses an accent that is not a hex color", async () => {
        const client = makeClient()
        await render(panel(client, {connectionId: "e1"}))
        await type(byTestId("agent-embed-accent"), "blue")
        await click(byTestId("agent-embed-save"))
        expect(document.querySelector('[role="alert"]')?.textContent).toContain("hex color")
        expect(client.editChannelConnection).not.toHaveBeenCalled()
    })

    it("archives after a confirm and steps back", async () => {
        const client = makeClient()
        const onBack = vi.fn()
        await render(panel(client, {connectionId: "e1", onBack}))
        await click(byTestId("agent-embed-archive"))
        expect(client.archiveChannelConnection).not.toHaveBeenCalled()
        await click(byTestId("agent-embed-archive-confirm"))
        expect(client.archiveChannelConnection).toHaveBeenCalledWith({connection_id: "e1"}, SCOPE)
        expect(onBack).toHaveBeenCalled()
    })

    it("opens from the Publish hub with the embed's own back step", async () => {
        const client = makeClient()
        const renderPanel = ({open, title, onBack, children}: ChannelsPanelRenderProps) =>
            open ? (
                <div role="dialog" data-title={title}>
                    {onBack ? <button data-testid="back" onClick={onBack} /> : null}
                    {children}
                </div>
            ) : null
        const Harness = () => {
            const channels = useChannelPanel({
                agentId: "agent-1",
                renderPanel,
                embed: (view) => panel(client, view),
            })
            return (
                <>
                    <button
                        data-testid="open-hub"
                        onClick={() => channels.openRoute({view: "hub"})}
                    />
                    {channels.panel}
                </>
            )
        }
        await render(<Harness />)
        await click(byTestId("open-hub"))
        await click(byTestId("channels-hub-embed"))
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
        expect(document.querySelector('[role="dialog"]')?.getAttribute("data-title")).toBe("Embed")
        await click(byTestId("agent-embed-e1"))
        expect(byTestId("agent-embed-settings")).not.toBeNull()
        await click(byTestId("back"))
        expect(byTestId("agent-embed-panel")).not.toBeNull()
    })
})
