// @vitest-environment jsdom
/**
 * The conversation lifetime (design D6, task 7.2, QA plan T4): a move from a session to an agent
 * page changes the page file, so the conversation unmounts. When the person comes back, the remount
 * puts back the composer text, the scroll position and an open quick action, keyed by session id.
 *
 * The probe mounts the three real pieces the conversation uses for that state: the composer draft
 * (`@agenta/chat`), the transcript auto-scroll and the quick action memory. A running answer is the
 * chat registry's job (`@agenta/chat` keeps a streaming `Chat` across a remount, tested there).
 */
import {act, useEffect} from "react"

import {useComposerDraft} from "@agenta/chat/hooks"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@/lib/motion/presets", () => ({useMotionPresets: () => ({reduced: true})}))
// The real draft hook, loaded from its own file: the `@agenta/chat/hooks` barrel pulls the whole
// chat engine, which this test does not need and which takes minutes to transform.
vi.mock("@agenta/chat/hooks", async () => ({
    useComposerDraft: (await import("../../../packages/agenta-chat/src/hooks/useComposerDraft"))
        .useComposerDraft,
}))
vi.mock("@agenta/entities/session", () => ({isSessionFresh: () => false}))

import {useConversationQuickAction} from "@/features/chat/conversationMemory"
import {useTranscriptAutoScroll} from "@/features/chat/useTranscriptAutoScroll"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

beforeAll(() => {
    // jsdom has no ResizeObserver; the hook only needs one to exist.
    globalThis.ResizeObserver ??= class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
    } as unknown as typeof ResizeObserver
})

/** The transcript's size; jsdom lays nothing out. */
const geometry = {scrollHeight: 2000, clientHeight: 500}

let composerText = ""
let quick: ReturnType<typeof useConversationQuickAction>
let initialDraft: string | undefined
let scroller: HTMLDivElement | null = null
const measured = new WeakSet<HTMLDivElement>()

const Conversation = ({sessionId, turns}: {sessionId: string; turns: string[]}) => {
    const inputRef = {
        current: {getMarkdown: () => composerText} as unknown as RichChatInputHandle,
    }
    const draft = useComposerDraft({sessionId, richInputRef: inputRef})
    initialDraft = draft.initialDraft
    quick = useConversationQuickAction(sessionId)
    const autoScroll = useTranscriptAutoScroll(turns, sessionId)
    useEffect(() => () => void (scroller = null), [])
    return (
        <div
            ref={(el) => {
                if (el && !measured.has(el)) {
                    measured.add(el)
                    Object.defineProperty(el, "scrollHeight", {get: () => geometry.scrollHeight})
                    Object.defineProperty(el, "clientHeight", {get: () => geometry.clientHeight})
                }
                autoScroll.ref.current = el
                scroller = el
            }}
            onScroll={autoScroll.onScroll}
        />
    )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    composerText = ""
    geometry.scrollHeight = 2000
    geometry.clientHeight = 500
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const mount = (sessionId: string, turns = ["t1", "t2"]) =>
    act(async () => root.render(<Conversation sessionId={sessionId} turns={turns} />))
const leave = () => act(async () => root.render(<div data-testid="agent-page" />))
/** The reader scrolls up: input first (it ends the follow), then the new position. */
const readerScrollsTo = (top: number) =>
    act(async () => {
        scroller?.dispatchEvent(new WheelEvent("wheel"))
        if (scroller) scroller.scrollTop = top
        scroller?.dispatchEvent(new Event("scroll"))
    })

describe("leave the session for an agent page and come back", () => {
    it("restores the composer text, the scroll position and the open quick action", async () => {
        await mount("session-a")
        // A new session lands on its latest message.
        expect(scroller?.scrollTop).toBe(1500)

        composerText = "make the greeting shorter"
        await readerScrollsTo(600)
        await act(async () => quick[1]("test"))

        await leave()
        expect(scroller).toBeNull()

        await mount("session-a")
        expect(initialDraft).toBe("make the greeting shorter")
        expect(scroller?.scrollTop).toBe(600)
        expect(quick[0]).toBe("test")
    })

    it("keeps the place from the end when the transcript grew while away", async () => {
        await mount("session-b")
        await readerScrollsTo(600)
        await leave()

        // A finished answer added 300 px below the place the reader was reading.
        geometry.scrollHeight = 2300
        await mount("session-b", ["t1", "t2", "t3"])
        expect(scroller?.scrollTop).toBe(600 + 300)
    })

    it("lands on the latest message again when the reader was there", async () => {
        await mount("session-c")
        await leave()
        geometry.scrollHeight = 2600
        await mount("session-c", ["t1", "t2", "t3"])
        expect(scroller?.scrollTop).toBe(2100)
    })

    it("waits for the transcript to load before it puts the position back", async () => {
        await mount("session-d")
        await readerScrollsTo(400)
        await leave()

        // Loading: nothing to scroll yet.
        geometry.scrollHeight = 500
        await mount("session-d", [])
        expect(scroller?.scrollTop).toBe(0)

        geometry.scrollHeight = 2000
        await mount("session-d", ["t1", "t2"])
        expect(scroller?.scrollTop).toBe(400)
    })

    it("keeps each session's state apart", async () => {
        await mount("session-e")
        composerText = "text for e"
        await readerScrollsTo(300)
        await act(async () => quick[1]("improve"))
        await leave()

        composerText = ""
        await mount("session-f")
        expect(initialDraft).toBeUndefined()
        expect(scroller?.scrollTop).toBe(1500)
        expect(quick[0]).toBeNull()
    })
})
