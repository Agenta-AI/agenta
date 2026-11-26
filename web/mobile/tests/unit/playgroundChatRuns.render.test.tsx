// @vitest-environment jsdom
/**
 * The chat run pane of the /m playground on the real controllers and the real workflow queries.
 * Only HTTP is mocked: the workflow endpoints answer from the fixtures below, and `fetch` stands
 * in for the workflow service that runs the prompt.
 */
import {act} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {ChatPanel} from "@agenta/playground-ui/panels/chat"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
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

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement
let turnIds: string[] = []

const Harness = () => {
    const {status, primaryRevisionId} = usePlaygroundSelection({appId: "app-chat-1"})
    if (status !== "ready" || !primaryRevisionId) return null
    return <ChatPanel revisionId={primaryRevisionId} />
}

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}
const readTurnIds = () =>
    [...host.querySelectorAll('[data-testid^="chat-turn-"]')].map((node) =>
        node.getAttribute("data-testid")!.replace("chat-turn-", ""),
    )
const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === label || item.getAttribute("aria-label") === label,
    )
const click = async (label: string) => {
    const target = button(label)
    expect(target, `a button named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}
const typeInto = async (field: HTMLTextAreaElement | HTMLInputElement, value: string) => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!
    await act(async () => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
/** The text of the user message of the first turn, set through the store. */
const writeUserMessage = async (text: string) => {
    turnIds = readTurnIds()
    await act(async () => {
        store.set(executionItemController.actions.patchMessage, {
            target: {turnId: turnIds[0], kind: "user"},
            updater: (m) => (m ? {...m, content: text} : m),
        })
    })
    await settle()
}
const variableField = () =>
    host.querySelector<HTMLTextAreaElement>('[data-testid="input-variable-name"] textarea')!
const toggle = () => host.querySelector<HTMLElement>('[aria-label="Toggle Chat"]')!
const storedUsers = () =>
    (store.get(executionItemController.selectors.messageIds) as string[])
        .map(
            (id) =>
                (
                    store.get(executionItemController.selectors.messagesById) as Record<
                        string,
                        {role: string; content: unknown}
                    >
                )[id],
        )
        .filter((m) => m?.role === "user")

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
    store.set(playgroundController.actions.resetAll)
})

describe("The chat run pane", () => {
    it("The header says Chat", () => {
        expect(toggle()).not.toBeNull()
        expect(host.querySelector('[aria-label="Toggle Generations"]')).toBeNull()
        expect(host.textContent).toContain("Chat")
    })

    it("Run sends the conversation and the variables, and shows the reply", async () => {
        await typeInto(variableField(), "Sam Lee")
        await writeUserMessage("Where should I go in May?")

        await click("Run")

        expect(runs).toHaveLength(1)
        const data = runs[0].body.data as {inputs: Record<string, unknown>}
        expect(data.inputs.messages).toEqual([{role: "user", content: "Where should I go in May?"}])
        expect(data.inputs.name).toBe("Sam Lee")
        expect(host.textContent).toContain("Lisbon is lovely in May.")
    })

    it("Run all runs the last turn and Cancel stops it", async () => {
        await writeUserMessage("Where should I go in May?")
        answer = never

        await click("Run all")

        expect(runs).toHaveLength(1)
        expect(host.textContent).toContain("Generating response...")
        expect(button("Clear")!.disabled).toBe(true)

        await click("Cancel")

        expect(button("Run all")).toBeDefined()
        expect(button("Clear")!.disabled).toBe(false)
    })

    it("Cmd or Ctrl Enter runs the last turn", async () => {
        await writeUserMessage("Where should I go in May?")

        await act(async () => {
            document.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Enter", metaKey: true, bubbles: true}),
            )
        })
        await settle()

        expect(runs).toHaveLength(1)
        expect(host.textContent).toContain("Lisbon is lovely in May.")
    })

    it("Clear removes the conversation and leaves one empty message", async () => {
        await writeUserMessage("Where should I go in May?")
        await click("Run")
        expect(host.textContent).toContain("Lisbon is lovely in May.")

        await click("Clear")

        expect(host.textContent).not.toContain("Lisbon is lovely in May.")
        const users = storedUsers()
        expect(users).toHaveLength(1)
        expect(users[0].content).toBe("")
        expect(readTurnIds()).toHaveLength(1)
        expect(host.textContent).toContain("No output yet")
    })

    it("Collapse all hides the variables and the prompt messages", async () => {
        const card = host.querySelector('[data-testid="input-variable-name"]')!
        const prompt = host.querySelector('[data-testid="chat-prompt-messages"]')!
        expect(prompt).not.toBeNull()
        expect(card.closest('[aria-hidden="true"]')).toBeNull()

        await act(async () => toggle().click())
        await settle()

        expect(card.closest('[aria-hidden="true"]')).not.toBeNull()
        expect(prompt.closest('[aria-hidden="true"]')).not.toBeNull()
        // The turns stay.
        expect(button("Run")).toBeDefined()
        expect(host.textContent).toContain("No output yet")
    })
})
