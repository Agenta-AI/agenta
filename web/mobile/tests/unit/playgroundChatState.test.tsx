// @vitest-environment jsdom
/**
 * The chat view-model hooks of the playground on the real controllers and the real workflow
 * queries. Only HTTP is mocked: the workflow endpoints answer from the fixtures below, and `fetch`
 * stands in for the workflow service that runs the prompt.
 */
import {act, memo, useMemo} from "react"

import {
    executionController,
    executionItemController,
    playgroundController,
} from "@agenta/playground"
import type {ChatMessage} from "@agenta/playground"
import {
    useChatConfigMessages,
    useGatewayToolActions,
    useTurnMessage,
    type TurnMessageModel,
} from "@agenta/playground-ui/hooks"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import type {MessageContent} from "@agenta/shared/types"
import {getAttachments} from "@agenta/shared/utils"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore, useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

const {http, router} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
}))

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
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
                messages: [{role: "system", content: "You help {{name}} plan trips."}],
                llm_config: {model: "gpt-4o-mini"},
            },
            followup: {
                messages: [{role: "system", content: "Answer in one line."}],
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

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

// ---------------------------------------------------------------------------
// Hosts: each one renders one hook and exposes what it returns to the test.
// ---------------------------------------------------------------------------

const models = new Map<string, TurnMessageModel>()
const renders = new Map<string, number>()
let turnIds: string[] = []
let entity = ""

const MessageHost = memo(function MessageHost({
    entityId,
    rowId,
    kind,
}: {
    entityId: string
    rowId: string
    kind: "user" | "assistant"
}) {
    const model = useTurnMessage({entityId, rowId, kind})
    const key = `${rowId}:${kind}`
    models.set(key, model)
    renders.set(key, (renders.get(key) ?? 0) + 1)
    return null
})

const Turns = ({entityId}: {entityId: string}) => {
    const items = useAtomValue(
        useMemo(() => executionItemController.selectors.itemsByExecutionId(entityId), [entityId]),
    )
    const ids = Array.from(new Set(items.map((item) => item.rowId)))
    turnIds = ids
    return (
        <>
            {ids.map((rowId) => (
                <MessageHost key={rowId} entityId={entityId} rowId={rowId} kind="user" />
            ))}
        </>
    )
}

let configModel: ReturnType<typeof useChatConfigMessages> | null = null
const ConfigHost = ({entityId}: {entityId: string}) => {
    configModel = useChatConfigMessages(entityId)
    return null
}

const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-chat-1"})
    if (status !== "ready" || !primaryRevisionId) return null
    entity = primaryRevisionId
    return (
        <>
            <Turns entityId={primaryRevisionId} />
            <ConfigHost entityId={primaryRevisionId} />
        </>
    )
}

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}

const allMessages = (): ChatMessage[] => {
    const ids = store.get(executionItemController.selectors.messageIds) as string[]
    const byId = store.get(executionItemController.selectors.messagesById) as Record<
        string,
        ChatMessage
    >
    return ids.map((id) => byId[id]).filter(Boolean)
}
const user = (index = 0) => models.get(`${turnIds[index]}:user`)!
const textOf = (content: MessageContent | undefined) =>
    typeof content === "string"
        ? content
        : (content ?? [])
              .filter((part) => part.type === "text")
              .map((part) => (part as {text: string}).text)
              .join("")

const typeMessage = async (index: number, text: string) => {
    await act(async () => user(index).onChangeText(text))
}
const runTurn = async (rowId: string) => {
    await act(async () => {
        store.set(executionItemController.actions.triggerTest, {
            executionId: entity,
            step: {id: rowId},
        })
    })
    await settle()
}
const addTurn = async () => {
    await act(async () => {
        store.set(executionItemController.actions.addUserMessage, {userMessage: null})
    })
    await settle()
}

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    window.localStorage.removeItem("agenta:playground:mode")
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    projectId = `proj-${Number(projectId.slice(5)) + 1}`
    store.set(projectIdAtom, projectId)
    store.set(sessionAtom, true)
    router.query = {workspace_id: "ws-1", project_id: projectId, app_id: "app-chat-1"}
    router.replace.mockReset()
    router.replace.mockResolvedValue(true)
    runs.length = 0
    models.clear()
    renders.clear()
    turnIds = []
    configModel = null
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
    store.set(playgroundController.actions.resetAll)
})

describe("The chat state hooks", () => {
    it("Starts in chat mode with one blank user message", () => {
        expect(store.get(executionController.selectors.isChatMode)).toBe(true)
        expect(turnIds).toHaveLength(1)
        expect(user().message?.role).toBe("user")
        expect(user().editorText).toBe("")
    })

    it("Editing a user message changes only its text", async () => {
        const before = allMessages()
        await typeMessage(0, "Plan a trip for Alex")

        const after = allMessages()
        expect(after).toHaveLength(before.length)
        expect(after[0]).toEqual({...before[0], content: "Plan a trip for Alex"})
        expect(user().editorText).toBe("Plan a trip for Alex")
    })

    it("Re-run deletes the reply and every later turn, then runs the turn", async () => {
        await typeMessage(0, "Where should Alex go?")
        await runTurn(turnIds[0])
        expect(allMessages().some((m) => m.role === "assistant")).toBe(true)

        answer = reply("Porto, then Lisbon.")
        await addTurn()
        await typeMessage(1, "And after that?")
        await runTurn(turnIds[1])
        expect(user(0).hasBeenRun).toBe(true)
        runs.length = 0

        answer = reply("Try Madeira.")
        await act(async () => user(0).rerun())
        await settle()

        // Only the turn that re-ran is sent: no old reply, no later turn.
        expect(runs).toHaveLength(1)
        const data = runs[0].body.data as {inputs: {messages: unknown}}
        expect(data.inputs.messages).toEqual([{role: "user", content: "Where should Alex go?"}])
        // The conversation is the re-run turn, its new reply, and the blank next turn.
        expect(allMessages().map((m) => [m.role, textOf(m.content)] as const)).toEqual([
            ["user", "Where should Alex go?"],
            ["assistant", "Try Madeira."],
            ["user", ""],
        ])
    })

    it("Remove on the only user message leaves one blank user message", async () => {
        await typeMessage(0, "Hello")
        const removedId = user().message!.id

        await act(async () => user().remove())
        await settle()

        const messages = allMessages()
        expect(messages).toHaveLength(1)
        expect(messages[0].role).toBe("user")
        expect(messages[0].id).not.toBe(removedId)
        expect(textOf(messages[0].content)).toBe("")
    })

    it("Removing a new upload keeps the attachments the message already had", async () => {
        await act(async () => {
            store.set(executionItemController.actions.patchMessage, {
                target: {turnId: turnIds[0], kind: "user"},
                updater: (m) =>
                    m
                        ? {
                              ...m,
                              content: [
                                  {type: "text", text: "Look at this"},
                                  {type: "image_url", image_url: {url: "https://img.test/old.png"}},
                              ],
                          }
                        : m,
            })
        })
        await act(async () => user().addUploadSlot("image"))
        const slotId = user().uploadSlots[0].id
        await act(async () =>
            user().setSlotImage(slotId, {
                uid: "u1",
                name: "new.png",
                base64: "data:image/png;base64,TkVX",
            }),
        )
        expect(getAttachments(user().message!.content ?? null)).toHaveLength(2)
        // The attachment the message already had stays listed while the slot is open.
        expect(getAttachments(user().listedAttachments)).toEqual([
            {type: "image_url", image_url: {url: "https://img.test/old.png"}},
        ])

        await act(async () => user().removeSlot(slotId))

        const left = getAttachments(user().message!.content ?? null)
        expect(left).toHaveLength(1)
        expect(left[0]).toMatchObject({image_url: {url: "https://img.test/old.png"}})
        expect(user().uploadSlots).toHaveLength(0)
    })

    it("Replacing an upload keeps one image", async () => {
        await act(async () => user().addUploadSlot("image"))
        const slotId = user().uploadSlots[0].id
        await act(async () =>
            user().setSlotImage(slotId, {
                uid: "u1",
                name: "a.png",
                base64: "data:image/png;base64,QQ==",
            }),
        )
        await act(async () =>
            user().setSlotImage(slotId, {
                uid: "u2",
                name: "b.png",
                base64: "data:image/png;base64,Qg==",
            }),
        )

        const images = getAttachments(user().message!.content ?? null)
        expect(images).toHaveLength(1)
        expect(images[0]).toMatchObject({image_url: {url: "data:image/png;base64,Qg=="}})
    })

    it("The prompt's messages come from every prompt in the config", () => {
        expect(configModel!.messages.map((m) => textOf(m.content as MessageContent))).toEqual([
            "You help {{name}} plan trips.",
            "Answer in one line.",
        ])
        expect(configModel!.templateFormat).toBeDefined()
    })

    it("Typing in one message does not re-render the others", async () => {
        await addTurn()
        expect(turnIds).toHaveLength(2)
        const first = `${turnIds[0]}:user`
        const second = `${turnIds[1]}:user`
        const firstBefore = renders.get(first)!
        const secondBefore = renders.get(second)!

        await typeMessage(1, "S")
        await typeMessage(1, "Sa")
        await typeMessage(1, "Sam")

        expect(renders.get(second)! - secondBefore).toBeGreaterThanOrEqual(3)
        expect(renders.get(first)).toBe(firstBefore)
    })
})

// ---------------------------------------------------------------------------
// Gateway tool results
// ---------------------------------------------------------------------------

const TOOL = "tools__composio__gmail__SEND_EMAIL__conn1"
let gateway: ReturnType<typeof useGatewayToolActions> | null = null
const executeToolCall = vi.fn()
const onRun = vi.fn()

const GatewayHost = ({entityId, rowId}: {entityId: string; rowId: string}) => {
    gateway = useGatewayToolActions({
        rowId,
        entityId,
        currentResult: null,
        onRun,
        onExecuteToolCall: executeToolCall,
    })
    return null
}

const seedToolCall = async (withToolMessage: boolean) => {
    const rowId = turnIds[0]
    const sessionId = `sess:${entity}`
    await act(async () => {
        store.set(executionItemController.actions.addMessage, {
            message: {
                id: "msg-assistant-1",
                role: "assistant",
                content: "",
                parentId: rowId,
                sessionId,
                tool_calls: [
                    {
                        id: "call_1",
                        type: "function",
                        function: {name: TOOL, arguments: '{"to":"alex@example.com"}'},
                    },
                ],
            },
        })
        if (withToolMessage) {
            store.set(executionItemController.actions.addMessage, {
                message: {
                    id: "msg-tool-other",
                    role: "tool",
                    name: "other",
                    tool_call_id: "call_0",
                    content: "",
                    parentId: rowId,
                    sessionId,
                },
            })
            store.set(executionItemController.actions.addMessage, {
                message: {
                    id: "msg-tool-1",
                    role: "tool",
                    name: TOOL,
                    tool_call_id: "call_1",
                    content: "",
                    parentId: rowId,
                    sessionId,
                },
            })
        }
    })
    const gatewayRoot = createRoot(document.createElement("div"))
    act(() => gatewayRoot.render(<GatewayHost entityId={entity} rowId={rowId} />))
    await settle()
    return gatewayRoot
}

describe("The gateway tool hook", () => {
    beforeEach(() => {
        gateway = null
        executeToolCall.mockReset()
        executeToolCall.mockResolvedValue({call: {data: {content: "Email sent to Alex"}}})
        onRun.mockReset()
    })

    it("A gateway tool result fills the tool message with the same call id", async () => {
        const gatewayRoot = await seedToolCall(true)
        expect(gateway!.payloads.map((p) => p.callId)).toEqual(["call_1"])

        let outcome: unknown
        await act(async () => {
            outcome = await gateway!.execute(gateway!.payloads[0], true)
        })

        expect(outcome).toEqual({ok: true})
        expect(executeToolCall).toHaveBeenCalledTimes(1)
        const {data} = executeToolCall.mock.calls[0][0]
        expect(data).toMatchObject({id: "call_1", type: "function", function: {name: TOOL}})
        expect(JSON.parse(data.function.arguments)).toEqual({to: "alex@example.com"})
        const tools = allMessages().filter((m) => m.role === "tool")
        expect(tools).toHaveLength(2)
        expect(tools.find((m) => m.id === "msg-tool-1")!.content).toBe("Email sent to Alex")
        expect(tools.find((m) => m.id === "msg-tool-other")!.content).toBe("")
        expect(onRun).toHaveBeenCalledTimes(1)
        act(() => gatewayRoot.unmount())
    })

    it("A gateway tool result with no matching tool message adds one", async () => {
        const gatewayRoot = await seedToolCall(false)

        await act(async () => {
            await gateway!.execute(gateway!.payloads[0], false)
        })

        const tools = allMessages().filter((m) => m.role === "tool")
        expect(tools).toHaveLength(1)
        expect(tools[0]).toMatchObject({
            role: "tool",
            name: TOOL,
            tool_call_id: "call_1",
            content: "Email sent to Alex",
            parentId: turnIds[0],
            sessionId: `sess:${entity}`,
        })
        expect(onRun).not.toHaveBeenCalled()
        act(() => gatewayRoot.unmount())
    })

    it("A failed tool call returns the failure and writes nothing", async () => {
        const gatewayRoot = await seedToolCall(false)
        executeToolCall.mockRejectedValue(new Error("refused"))

        let outcome: {ok: boolean} | null = null
        await act(async () => {
            outcome = await gateway!.execute(gateway!.payloads[0], true)
        })

        expect(outcome).toMatchObject({ok: false})
        expect(allMessages().filter((m) => m.role === "tool")).toHaveLength(0)
        expect(onRun).not.toHaveBeenCalled()
        expect(gateway!.executingId).toBeNull()
        act(() => gatewayRoot.unmount())
    })
})
