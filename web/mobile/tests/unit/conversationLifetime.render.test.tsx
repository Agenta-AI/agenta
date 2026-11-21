// @vitest-environment jsdom
/**
 * The conversation lifetime (design D6, task 7.2, QA plan T4): a move from a session to an agent
 * page changes the page file, so the conversation unmounts. When the person comes back, the remount
 * puts back the composer text, the transcript position and an open quick action, by session id.
 *
 * The probe mounts the real pieces the conversation uses for that state: the composer draft
 * (`@agenta/chat`), the transcript window with the auto-scroll, and the quick action atom, on a
 * scroller whose height is its rendered rows. A running answer is the chat registry's job
 * (`@agenta/chat` keeps a streaming `Chat` across a remount, tested there).
 */
import {act, type RefObject, useMemo} from "react"

import {useComposerDraft} from "@agenta/chat/hooks"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {createStore, Provider, useAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@/lib/motion/presets", () => ({useMotionPresets: () => ({reduced: true})}))
// The real draft hook, loaded from its own file: the `@agenta/chat/hooks` barrel pulls the whole
// chat engine, which this test does not need and which takes minutes to transform.
vi.mock("@agenta/chat/hooks", async () => ({
    useComposerDraft: (await import("../../../packages/agenta-chat/src/hooks/useComposerDraft"))
        .useComposerDraft,
}))
vi.mock("@agenta/entities/session", () => ({isSessionFresh: () => false}))

import {conversationQuickActionAtomFamily} from "@/features/chat/conversationQuickAction"
import {useTranscriptAutoScroll} from "@/features/chat/useTranscriptAutoScroll"
import {useTranscriptWindow} from "@/features/chat/useTranscriptWindow"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const ROW_PX = 100
const VIEWPORT_PX = 700

let composerText = ""
let initialDraft: string | undefined
let quickAction: string | null = null
let setQuickAction: (next: string | null) => void = () => undefined

const Conversation = ({sessionId, count}: {sessionId: string; count: number}) => {
    const turns = useMemo(() => Array.from({length: count}, (_, i) => i), [count])
    const inputRef = useMemo(
        () => ({current: {getMarkdown: () => composerText} as unknown as RichChatInputHandle}),
        [],
    )
    initialDraft = useComposerDraft({sessionId, richInputRef: inputRef}).initialDraft
    ;[quickAction, setQuickAction] = useAtom(conversationQuickActionAtomFamily(sessionId))
    const autoScroll = useTranscriptAutoScroll(turns, sessionId)
    return (
        <div ref={autoScroll.ref} onScroll={autoScroll.onScroll} data-testid="scroller">
            {/* As in the app: the transcript mounts once the turns are loaded. */}
            {count > 0 ? (
                <Rows turns={turns} sessionId={sessionId} scrollerRef={autoScroll.ref} />
            ) : null}
        </div>
    )
}

const Rows = ({
    turns,
    sessionId,
    scrollerRef,
}: {
    turns: number[]
    sessionId: string
    scrollerRef: RefObject<HTMLDivElement | null>
}) => {
    const start = useTranscriptWindow(turns.length, scrollerRef, sessionId)
    return (
        <div>
            {turns.slice(start).map((turn) => (
                <div key={turn} data-row={turn} />
            ))}
        </div>
    )
}

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

beforeEach(() => {
    composerText = ""
    store = createStore()
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe = vi.fn()
            disconnect = vi.fn()
        },
    )
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
        this: HTMLElement,
    ) {
        return this.querySelectorAll("[data-row]").length * ROW_PX
    })
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(VIEWPORT_PX)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

const scroller = () => host.querySelector<HTMLDivElement>("[data-testid=scroller]")
const firstRow = () => host.querySelector("[data-row]")?.getAttribute("data-row")
const mount = (sessionId: string, count = 40) =>
    act(async () =>
        root.render(
            <Provider store={store}>
                <Conversation sessionId={sessionId} count={count} />
            </Provider>,
        ),
    )
const leave = () => act(async () => root.render(<div data-testid="agent-page" />))
/** The reader scrolls: input first (it ends the follow), then the new position. */
const readerScrollsTo = async (top: number) => {
    await act(async () => {
        const el = scroller()!
        el.dispatchEvent(new WheelEvent("wheel"))
        el.scrollTop = top
        el.dispatchEvent(new Event("scroll"))
    })
    // A browser fires a scroll event for a programmatic move too (the window keeps the reader's
    // place when it adds older turns); jsdom does not.
    await act(async () => {
        scroller()!.dispatchEvent(new Event("scroll"))
    })
}

describe("leave the session for an agent page and come back", () => {
    it("restores the composer text, the transcript position and the open quick action", async () => {
        await mount("session-a")
        // The tail of 12 turns, pinned to the latest.
        expect(firstRow()).toBe("28")
        expect(scroller()?.scrollTop).toBe(500)

        // The reader scrolls up past the tail: 12 older turns load, then they park in them.
        await readerScrollsTo(0)
        expect(firstRow()).toBe("16")
        await readerScrollsTo(700)
        composerText = "make the greeting shorter"
        await act(async () => setQuickAction("test"))

        await leave()
        expect(scroller()).toBeNull()

        await mount("session-a")
        expect(initialDraft).toBe("make the greeting shorter")
        expect(firstRow()).toBe("16")
        expect(scroller()?.scrollTop).toBe(700)
        expect(quickAction).toBe("test")
    })

    it("keeps the same turns on screen when an answer arrived while away", async () => {
        await mount("session-b")
        await readerScrollsTo(200)
        const before = {firstRow: firstRow(), scrollTop: scroller()?.scrollTop}
        await leave()

        // One more turn below the place the reader was reading.
        await mount("session-b", 41)
        expect({firstRow: firstRow(), scrollTop: scroller()?.scrollTop}).toEqual(before)
    })

    it("keeps the place when a fresher history with many more turns arrives after the return", async () => {
        await mount("session-g")
        await readerScrollsTo(0)
        await readerScrollsTo(700)
        const before = {firstRow: firstRow(), scrollTop: scroller()?.scrollTop}
        await leave()

        // The cached history first, then the server's, 20 turns longer.
        await mount("session-g", 40)
        await mount("session-g", 60)
        expect({firstRow: firstRow(), scrollTop: scroller()?.scrollTop}).toEqual(before)
    })

    it("lands on the latest message again when the reader was there", async () => {
        await mount("session-c")
        await leave()
        // The tail of the longer transcript, pinned to its latest message.
        await mount("session-c", 41)
        expect(firstRow()).toBe("29")
        expect(scroller()?.scrollTop).toBe(500)
    })

    it("waits for the transcript to load before it puts the position back", async () => {
        await mount("session-d")
        await readerScrollsTo(300)
        const before = {firstRow: firstRow(), scrollTop: scroller()?.scrollTop}
        await leave()

        // Loading: no turns yet.
        await mount("session-d", 0)
        expect(scroller()?.scrollTop).toBe(0)

        await mount("session-d", 40)
        expect({firstRow: firstRow(), scrollTop: scroller()?.scrollTop}).toEqual(before)
    })

    it("keeps each session's state apart", async () => {
        await mount("session-e")
        composerText = "text for e"
        await readerScrollsTo(300)
        await act(async () => setQuickAction("improve"))
        await leave()

        composerText = ""
        await mount("session-f")
        expect(initialDraft).toBeUndefined()
        expect(scroller()?.scrollTop).toBe(500)
        expect(quickAction).toBeNull()
    })
})
