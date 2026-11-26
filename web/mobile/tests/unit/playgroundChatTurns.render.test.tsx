// @vitest-environment jsdom
/**
 * The turns of the /m playground chat on the real controllers and the real workflow queries.
 * Only HTTP is mocked: the workflow endpoints answer from the fixtures below, `fetch` stands in
 * for the workflow service that runs the prompt, and the tools client stands in for the tool
 * endpoint.
 */
import {act} from "react"

import {
    executionController,
    executionItemController,
    playgroundController,
} from "@agenta/playground"
import type {ChatMessage as StoredMessage} from "@agenta/playground"
import {ChatTurns} from "@agenta/playground-ui/panels/chat"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

const {http, router, toast, callTool} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
    toast: {success: vi.fn(), error: vi.fn()},
    callTool: vi.fn(),
}))

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<object>()),
    getToolsClient: () => ({callTool}),
}))
vi.mock("@agenta/ui/app-message", async (original) => {
    const actual = await original<typeof import("@agenta/ui/app-message")>()
    return {...actual, message: Object.assign(Object.create(actual.message), toast)}
})

let projectId = "proj-0"
const revision = {
    id: "rev-chat-1",
    version: 2,
    name: "default",
    workflow_id: "app-chat-1",
    workflow_variant_id: "app-chat-1-variant",
    flags: {is_application: true, is_chat: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {
        uri: "agenta:builtin:chat:v0",
        parameters: {
            prompt: {
                messages: [{role: "system", content: "You help Alex plan trips."}],
                llm_config: {model: "gpt-4o-mini"},
            },
        },
    },
}
http.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/workflows/query")) {
        return {data: {count: 1, workflows: [{id: "app-chat-1", name: "Trips", flags: {}}]}}
    }
    if (url.endsWith("/workflows/revisions/query")) {
        return {data: {count: 1, workflow_revisions: [revision]}}
    }
    return {data: {}}
})
http.get.mockResolvedValue({data: {}})

/** What the workflow service receives, and what it answers. */
const runs: {body: Record<string, unknown>}[] = []
let answer: () => Promise<Response>
const respond =
    (payload: unknown, status = 200) =>
    async () =>
        new Response(JSON.stringify(payload), {status})
const reply = (text: string) =>
    respond({data: {role: "assistant", content: text}, trace_id: "trace-1"})
const never = () => new Promise<Response>(() => undefined)

const GATEWAY_TOOL = "tools__composio__gmail__send__work"
const gatewayCall = {
    id: "call_1",
    type: "function" as const,
    function: {name: GATEWAY_TOOL, arguments: '{"to":"alex@example.com"}'},
}

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let entity = ""

const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-chat-1"})
    if (status !== "ready" || !primaryRevisionId) return null
    entity = primaryRevisionId
    return (
        <ChatTurns
            entityId={primaryRevisionId}
            renderTraceFooter={(traceId) => <span>{`Trace ${traceId}`}</span>}
        />
    )
}

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}

const allMessages = (): StoredMessage[] => {
    const ids = store.get(executionItemController.selectors.messageIds) as string[]
    const byId = store.get(executionItemController.selectors.messagesById) as Record<
        string,
        StoredMessage
    >
    return ids.map((id) => byId[id]).filter(Boolean)
}
const turnIds = () =>
    [...host.querySelectorAll('[data-testid^="chat-turn-"]')].map((node) =>
        node.getAttribute("data-testid")!.replace("chat-turn-", ""),
    )
const seed = async (messages: Partial<StoredMessage>[], turnIndex = 0) => {
    await act(async () => {
        for (const message of messages) {
            store.set(executionItemController.actions.addMessage, {
                message: {
                    id: `msg-${Math.random().toString(36).slice(2)}`,
                    role: "assistant",
                    content: "",
                    parentId: turnIds()[turnIndex],
                    sessionId: `sess:${entity}`,
                    ...message,
                } as StoredMessage,
            })
        }
    })
    await settle()
}
/** The kinds of the messages on screen, top to bottom. */
const order = () =>
    [...host.querySelectorAll('[data-testid^="chat-message-"]')].map((node) =>
        node.getAttribute("data-testid")!.replace("chat-message-", ""),
    )

const button = (label: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === label || item.getAttribute("aria-label") === label,
    )
const click = async (label: string) => {
    const target = button(label)
    expect(target, `a button named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
/** Radix opens a menu on a primary-button pointer down, which jsdom has no PointerEvent for. */
const openMenu = async (trigger: Element) => {
    await act(async () => {
        trigger.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, button: 0}))
    })
    await settle()
}
const menuItem = (label: string) =>
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.trim() === label,
    )

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    // jsdom has none of these; the menus and the editor read them.
    Range.prototype.getBoundingClientRect = () => new DOMRect()
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {
                return undefined
            }
            unobserve() {
                return undefined
            }
            disconnect() {
                return undefined
            }
        },
    )
    window.localStorage.removeItem("agenta:playground:mode")
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-chat-1"}
    router.replace.mockReset()
    router.replace.mockResolvedValue(true)
    toast.success.mockReset()
    toast.error.mockReset()
    callTool.mockReset()
    runs.length = 0
    answer = reply("Lisbon is lovely in May.")
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        runs.push({body: JSON.parse(String(init.body))})
        return answer()
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(<Harness />))
    await settle()
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    store.set(executionController.actions.setRepetitionCount, 1)
    store.set(playgroundController.actions.resetAll)
})

describe("The chat turns", () => {
    it("The last turn without a reply shows No output yet", async () => {
        expect(turnIds()).toHaveLength(1)
        expect(host.textContent).toContain("No output yet")

        await click("Message")

        expect(turnIds()).toHaveLength(2)
        // Only the last turn carries the block.
        expect(host.textContent?.match(/No output yet/g)).toHaveLength(1)
    })

    it("A running turn shows Generating response", async () => {
        answer = never
        await click("Run")

        expect(host.querySelector('[role="status"]')?.textContent).toContain(
            "Generating response...",
        )
        expect(host.textContent).not.toContain("No output yet")
        expect(button("Cancel")).toBeDefined()
    })

    it("A rerun keeps the old reply under Re-running", async () => {
        answer = never
        await click("Run")
        expect(host.textContent).toContain("Generating response...")

        // The run clears the old reply when it starts, so the reply comes back while it runs.
        await seed([{role: "assistant", content: "Lisbon is lovely in May."}])

        expect(host.textContent).toContain("Re-running...")
        expect(host.textContent).toContain("Lisbon is lovely in May.")
        expect(host.textContent).not.toContain("Generating response...")
    })

    it("Tool replies follow the first assistant message", async () => {
        await seed([
            {
                role: "assistant",
                content: "Checking.",
                tool_calls: [{...gatewayCall, function: {name: "get_weather", arguments: "{}"}}],
            },
            {role: "tool", name: "get_weather", tool_call_id: "call_1", content: '{"sky":"clear"}'},
        ])

        expect(order()).toEqual(["user", "assistant", "tool"])
    })

    it("Call tool and send to chat calls the tool, fills the reply and runs the turn", async () => {
        callTool.mockResolvedValue({call: {data: {content: "Sent to Alex."}}})
        await seed([
            {role: "assistant", content: "", tool_calls: [gatewayCall]},
            {role: "tool", name: GATEWAY_TOOL, tool_call_id: "call_1", content: ""},
        ])
        runs.length = 0

        await click("Call tool and send to chat")

        expect(callTool).toHaveBeenCalledTimes(1)
        const sent = callTool.mock.calls[0][0].data
        expect(sent).toMatchObject({id: "call_1", type: "function"})
        expect(sent.function.name).toBe(GATEWAY_TOOL)
        expect(JSON.parse(sent.function.arguments)).toEqual({to: "alex@example.com"})
        const tools = allMessages().filter((m) => m.role === "tool")
        expect(tools).toHaveLength(1)
        expect(tools[0].content).toBe("Sent to Alex.")
        expect(runs).toHaveLength(1)
        // The continuation run sends the tool result back to the model.
        const sentMessages = (runs[0].body.data as {inputs: {messages: Record<string, unknown>[]}})
            .inputs.messages
        expect(sentMessages).toContainEqual(
            expect.objectContaining({
                role: "tool",
                tool_call_id: "call_1",
                content: "Sent to Alex.",
            }),
        )
    })

    it("Call tool fills the reply and does not run", async () => {
        callTool.mockResolvedValue({call: {data: {content: "Sent to Alex."}}})
        await seed([
            {role: "assistant", content: "", tool_calls: [gatewayCall]},
            {role: "tool", name: GATEWAY_TOOL, tool_call_id: "call_1", content: ""},
        ])
        runs.length = 0

        await openMenu(button("Tool options")!)
        await act(async () => menuItem("Call tool")!.click())
        await settle()

        expect(callTool).toHaveBeenCalledTimes(1)
        expect(allMessages().find((m) => m.role === "tool")?.content).toBe("Sent to Alex.")
        expect(runs).toHaveLength(0)
    })

    it("A failed tool call shows Tool execution failed", async () => {
        callTool.mockRejectedValue(new Error("403"))
        await seed([
            {role: "assistant", content: "", tool_calls: [gatewayCall]},
            {role: "tool", name: GATEWAY_TOOL, tool_call_id: "call_1", content: ""},
        ])
        runs.length = 0

        await click("Call tool and send to chat")

        expect(toast.error).toHaveBeenCalledWith("Tool execution failed")
        expect(allMessages().find((m) => m.role === "tool")?.content).toBe("")
        expect(runs).toHaveLength(0)
    })

    it("Repeats page through the replies", async () => {
        store.set(executionController.actions.setRepetitionCount, 2)
        let count = 0
        // The workflow service wraps the reply in `outputs`.
        answer = async () =>
            respond({
                data: {
                    outputs: {
                        role: "assistant",
                        content: count++ === 0 ? "First take." : "Second take.",
                    },
                },
                trace_id: "trace-1",
            })()
        await click("Run")

        expect(host.textContent).toContain("1 / 2")
        expect(host.textContent).toContain("First take.")
        expect(host.textContent).not.toContain("Second take.")

        await click("Next repeat")

        expect(host.textContent).toContain("2 / 2")
        expect(host.textContent).toContain("Second take.")
        expect(host.textContent).not.toContain("First take.")
        expect(button("Next repeat")!.disabled).toBe(true)

        await click("Previous repeat")

        expect(host.textContent).toContain("1 / 2")
        expect(host.textContent).toContain("First take.")
        expect(host.textContent).not.toContain("Second take.")
    })

    it("Add message appends an empty user message and is disabled while running", async () => {
        await click("Message")

        const users = allMessages().filter((m) => m.role === "user")
        expect(users).toHaveLength(2)
        expect(users[1].content).toBe("")

        answer = never
        await click("Run")

        expect(button("Message")!.disabled).toBe(true)
    })
})
