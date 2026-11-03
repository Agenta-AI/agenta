// @vitest-environment jsdom
/**
 * One chat message of the /m playground on the real controllers and the real workflow queries.
 * Only HTTP is mocked: the workflow endpoints answer from the fixtures below.
 */
import {act, useMemo} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import type {ChatMessage as StoredMessage, SimpleChatMessage} from "@agenta/playground"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {getAttachments} from "@agenta/shared/utils"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore, useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {usePlaygroundSelection} from "@/features/playground/usePlaygroundSelection"

import {ChatMessage} from "../../../packages/agenta-playground-ui/src/panels/chat/ChatMessage"

// The chat panel has no package entry yet, so the message is imported by its path.

const {http, router, toast} = vi.hoisted(() => ({
    http: {post: vi.fn(), get: vi.fn()},
    router: {
        isReady: true,
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
    toast: {success: vi.fn(), error: vi.fn()},
}))

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => router,
}))
vi.mock("@agenta/shared/api", async (original) => {
    const actual = await original<typeof import("@agenta/shared/api")>()
    return {...actual, axios: Object.assign(Object.create(actual.axios), http)}
})
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

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

type Kind = "user" | "assistant" | "tool"
/** Which messages the harness shows: one `ChatMessage` per entry, for the first turn. */
let shown: {kind: Kind; toolIndex?: number; override?: SimpleChatMessage}[] = [{kind: "user"}]
let entity = ""
let turnIds: string[] = []

const Turns = ({entityId}: {entityId: string}) => {
    const items = useAtomValue(
        useMemo(() => executionItemController.selectors.itemsByExecutionId(entityId), [entityId]),
    )
    turnIds = Array.from(new Set(items.map((item) => item.rowId)))
    if (!turnIds[0]) return null
    return (
        <>
            {shown.map((item) => (
                <ChatMessage
                    key={`${item.kind}-${item.toolIndex ?? 0}`}
                    entityId={entityId}
                    rowId={turnIds[0]}
                    kind={item.kind}
                    toolIndex={item.toolIndex}
                    messageOverride={item.override}
                />
            ))}
        </>
    )
}

const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-chat-1"})
    if (status !== "ready" || !primaryRevisionId) return null
    entity = primaryRevisionId
    return <Turns entityId={primaryRevisionId} />
}

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
const mount = async (items: typeof shown) => {
    shown = items
    act(() => root.render(<Harness />))
    await settle()
}

const allMessages = (): StoredMessage[] => {
    const ids = store.get(executionItemController.selectors.messageIds) as string[]
    const byId = store.get(executionItemController.selectors.messagesById) as Record<
        string,
        StoredMessage
    >
    return ids.map((id) => byId[id]).filter(Boolean)
}
const seed = async (messages: Partial<StoredMessage>[]) => {
    await act(async () => {
        for (const message of messages) {
            store.set(executionItemController.actions.addMessage, {
                message: {
                    id: `msg-${Math.random().toString(36).slice(2)}`,
                    role: "assistant",
                    content: "",
                    parentId: turnIds[0],
                    sessionId: `sess:${entity}`,
                    ...message,
                } as StoredMessage,
            })
        }
    })
    await settle()
}
const patchUser = async (content: unknown) => {
    await act(async () => {
        store.set(executionItemController.actions.patchMessage, {
            target: {turnId: turnIds[0], kind: "user"},
            updater: (m) => (m ? {...m, content: content as StoredMessage["content"]} : m),
        })
    })
    await settle()
}
const userMessage = () => allMessages().find((m) => m.role === "user" || m.role === "assistant")!

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

/** The Lexical editor of the nth editor on screen; its text is set through its own state. */
const typeInto = async (text: string, index = 0) => {
    const element = host.querySelectorAll<HTMLElement & {__lexicalEditor?: LexicalHandle}>(
        '[contenteditable="true"]',
    )[index]
    const editor = element.__lexicalEditor!
    await act(async () => {
        editor.setEditorState(
            editor.parseEditorState({
                root: {
                    type: "root",
                    version: 1,
                    direction: "ltr",
                    format: "",
                    indent: 0,
                    children: [
                        {
                            type: "paragraph",
                            version: 1,
                            direction: "ltr",
                            format: "",
                            indent: 0,
                            children: [
                                {
                                    type: "text",
                                    version: 1,
                                    detail: 0,
                                    format: 0,
                                    mode: "normal",
                                    style: "",
                                    text,
                                },
                            ],
                        },
                    ],
                },
            }),
        )
    })
    await settle()
}
interface LexicalHandle {
    setEditorState: (state: unknown) => void
    parseEditorState: (json: unknown) => unknown
}

const pasteTooLong = async () => {
    const element = host.querySelector<HTMLElement>('[contenteditable="true"]')!
    const pasted = "x".repeat(50_100)
    await act(async () => {
        const event = new Event("paste", {bubbles: true, cancelable: true})
        Object.assign(event, {
            clipboardData: {
                getData: (type: string) => (type === "text/plain" ? pasted : ""),
                types: ["text/plain"],
                files: [],
                items: [],
            },
        })
        element.dispatchEvent(event)
    })
    await settle()
}

beforeEach(async () => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    // jsdom has none of these; the menus and the editor read them.
    Range.prototype.getBoundingClientRect = () => new DOMRect()
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
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
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    store.set(playgroundController.actions.resetAll)
})

describe("A chat message", () => {
    it("A user message edits its text and role", async () => {
        await mount([{kind: "user"}])
        expect(host.querySelector('[aria-label="Type your message…"]')).not.toBeNull()
        // The text view shows the markdown source, so the empty message draws its own placeholder.
        const placeholderVar = () =>
            host
                .querySelector<HTMLElement>('[data-testid="chat-message-user"]')!
                .style.getPropertyValue("--chat-message-placeholder")
        expect(placeholderVar()).toBe('"Type your message…"')

        await typeInto("Plan a trip for Alex")
        expect(userMessage().content).toBe("Plan a trip for Alex")
        expect(placeholderVar()).toBe("")

        await openMenu(host.querySelector(".message-user-select")!)
        await act(async () => menuItem("assistant")!.click())
        await settle()
        expect(userMessage().role).toBe("assistant")
    })

    it("Re-run is disabled on a user message that never ran", async () => {
        await mount([{kind: "user"}])
        expect(button("Re-run")!.disabled).toBe(true)

        await seed([{role: "assistant", content: "Lisbon is lovely in May."}])
        expect(button("Re-run")!.disabled).toBe(false)
    })

    it("Copy copies the message text and shows Copied", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        vi.stubGlobal("navigator", {...navigator, clipboard: {writeText}})
        await mount([{kind: "user"}])
        await patchUser("Where should Sam Lee go?")

        await click("Copy")
        expect(writeText).toHaveBeenCalledWith("Where should Sam Lee go?")
        expect(button("Copied")).toBeDefined()

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1100))
        })
        expect(button("Copy")).toBeDefined()
        vi.unstubAllGlobals()
    })

    it("Remove deletes the message", async () => {
        await mount([{kind: "user"}, {kind: "assistant"}])
        await patchUser("Hello")
        await seed([{role: "assistant", content: "Hi Alex"}])
        expect(allMessages().map((m) => m.role)).toEqual(["user", "assistant"])

        // The second "Remove" belongs to the assistant message.
        const removes = [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter(
            (item) => item.getAttribute("aria-label") === "Remove",
        )
        expect(removes).toHaveLength(2)
        await act(async () => removes[1].click())
        await settle()
        expect(allMessages().map((m) => m.role)).toEqual(["user"])
        expect(allMessages()[0].content).toBe("Hello")
    })

    it("Add attachment offers image and document, and stops at five", async () => {
        await mount([{kind: "user"}])

        const addImage = async () => {
            await openMenu(button("Add attachment")!)
            await act(async () => menuItem("Upload image")!.click())
            await settle()
        }
        await openMenu(button("Add attachment")!)
        expect(menuItem("Upload image")).toBeDefined()
        expect(menuItem("Attach document")).toBeDefined()
        await act(async () => menuItem("Attach document")!.click())
        await settle()
        expect(host.querySelectorAll("input[type=file]")).toHaveLength(1)

        for (let i = 0; i < 5; i++) await addImage()
        expect(host.querySelectorAll("input[type=file]")).toHaveLength(6)

        await openMenu(button("Add attachment")!)
        expect(menuItem("Upload image")!.getAttribute("aria-disabled")).toBe("true")
        expect(menuItem("Attach document")!.getAttribute("aria-disabled")).not.toBe("true")
    })

    it("A long paste offers a snippet and attaches it", async () => {
        await mount([{kind: "user"}])
        await pasteTooLong()
        expect(document.body.textContent).toContain("That's too long to paste")
        expect(document.body.textContent).toContain("over the 50,000-character limit.")

        await click("Create Snippet")
        await settle()

        const files = getAttachments(userMessage().content ?? null)
        expect(files).toHaveLength(1)
        expect(files[0]).toMatchObject({type: "file", file: {filename: "snippet.pdf"}})
        expect(toast.success).toHaveBeenCalledWith("Attached snippet.pdf as a snippet.")
        expect(document.body.textContent).not.toContain("That's too long to paste")
    })

    it("A failed snippet shows a plain message", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {})
        const reader = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
            this: FileReader,
        ) {
            this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>)
        })
        await mount([{kind: "user"}])
        await pasteTooLong()

        await click("Create Snippet")
        await settle()

        expect(toast.error).toHaveBeenCalledWith("Failed to create snippet attachment.")
        expect(error).toHaveBeenCalled()
        expect(getAttachments(userMessage().content ?? null)).toHaveLength(0)
        reader.mockRestore()
        error.mockRestore()
    })

    it("A tool call shows its name and call id, and starts collapsed", async () => {
        await mount([{kind: "assistant"}])
        await seed([
            {
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id: "call_1",
                        type: "function",
                        function: {name: "get_weather", arguments: '{"city":"Lisbon"}'},
                    },
                    {
                        id: "call_2",
                        type: "function",
                        function: {name: "get_time", arguments: '{"city":"Lisbon"}'},
                    },
                ],
            },
        ])
        expect(host.textContent).toContain("get_weather")
        expect(host.textContent).toContain("call_1")
        expect(host.textContent).toContain("get_time")
        expect(host.textContent).toContain("call_2")
        // One read-only editor for each call.
        expect(host.querySelectorAll('[contenteditable="true"]')).toHaveLength(0)
        expect(host.querySelectorAll('[contenteditable="false"]').length).toBeGreaterThanOrEqual(2)
        // It starts collapsed, and a later expand sticks.
        expect(button("Expand")).toBeDefined()
        await click("Expand")
        await seed([])
        expect(button("Collapse")).toBeDefined()
    })

    it("An Error reply is read only", async () => {
        // A failed run shows a synthetic message, not a stored one.
        await mount([{kind: "assistant", override: {role: "Error", content: "The model refused."}}])
        expect(host.textContent).toContain("Error")
        expect(host.textContent).toContain("The model refused.")
        expect(host.querySelectorAll('[contenteditable="true"]')).toHaveLength(0)
        expect(host.querySelector(".message-user-select")!.hasAttribute("disabled")).toBe(true)
    })
})
