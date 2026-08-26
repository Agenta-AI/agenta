// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useVoiceInput} from "../../../src/hooks/useVoiceInput"

/**
 * Dictation's whole difficulty is that the recogniser answers on its own schedule: `start()`
 * settles on a later task, `stop()` only reports back once the browser has flushed a trailing
 * result and closed its speech socket, and a `start()` issued inside that teardown throws. The
 * cases below are exactly the ones that used to strand the mic latched-on, or swallow an entire
 * utterance spoken into a session that had already died.
 */

/** How long this fake takes to close a session — Chrome's is comparable and sometimes worse. */
const TEARDOWN_MS = 800

class FakeRecognition {
    static instances: FakeRecognition[] = []
    /** Chrome refuses a `start()` while a previous session is still closing. */
    static refuseWhileClosing = true

    state: "idle" | "running" | "closing" = "idle"
    continuous = false
    interimResults = false
    lang = ""
    onstart: (() => void) | null = null
    onresult: ((e: {resultIndex: number; results: ArrayLike<any>}) => void) | null = null
    onerror: ((e: {error: string}) => void) | null = null
    onend: (() => void) | null = null

    constructor() {
        FakeRecognition.instances.push(this)
    }

    start() {
        if (this.state === "running") throw new Error("InvalidStateError")
        if (this.state === "closing" && FakeRecognition.refuseWhileClosing) {
            throw new Error("InvalidStateError")
        }
        this.state = "running"
        this.onstart?.()
    }
    stop() {
        if (this.state !== "running") return
        this.state = "closing"
        setTimeout(() => {
            this.state = "idle"
            this.onend?.()
        }, TEARDOWN_MS)
    }
    abort() {
        if (this.state === "idle") return
        this.state = "idle"
        this.onend?.()
    }
    /** Chrome ends a session after a silent stretch even with `continuous` set. */
    endOnSilence() {
        this.state = "idle"
        this.onend?.()
    }
    say(text: string, isFinal: boolean): boolean {
        if (this.state !== "running") return false
        this.onresult?.({resultIndex: 0, results: {length: 1, 0: {isFinal, 0: {transcript: text}}}})
        return true
    }
}

const live = () => FakeRecognition.instances.filter((r) => r.state === "running")
const pristineStart = FakeRecognition.prototype.start

beforeEach(() => {
    vi.useFakeTimers()
    FakeRecognition.instances = []
    FakeRecognition.refuseWhileClosing = true
    FakeRecognition.prototype.start = pristineStart
    ;(window as any).SpeechRecognition = FakeRecognition
    ;(window as any).webkitSpeechRecognition = FakeRecognition
})

afterEach(() => {
    vi.useRealTimers()
})

describe("useVoiceInput", () => {
    it("transcribes committed words and the volatile tail separately", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => void live()[0].say("hello wor", false))
        expect(result.current.interimText).toBe("hello wor")
        act(() => void live()[0].say("hello world", true))
        expect(result.current.finalText).toBe("hello world")
    })

    it("unlatches the control the moment it is pressed, not when the browser finishes closing", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        expect(result.current.recording).toBe(true)

        act(() => result.current.stop())
        // The session is still closing, but the mic must not read as still recording — pressing it
        // again used to be a no-op for the whole teardown.
        expect(result.current.recording).toBe(false)
        expect(result.current.active).toBe(true)

        act(() => vi.advanceTimersByTime(TEARDOWN_MS))
        expect(result.current.active).toBe(false)
    })

    it("keeps the editor session open through the teardown so a trailing result still lands", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => void live()[0].say("first", true))
        act(() => result.current.stop())

        // The browser flushes one last result on its way out.
        act(() => void FakeRecognition.instances[0].onresult?.({
            resultIndex: 0,
            results: {length: 1, 0: {isFinal: true, 0: {transcript: "and last"}}},
        }))
        expect(result.current.active).toBe(true)
        expect(result.current.finalText).toBe("first and last")
    })

    it("revives a session the browser ended on its own after a silence", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => FakeRecognition.instances[0].endOnSilence())
        act(() => vi.runOnlyPendingTimers())

        expect(result.current.recording).toBe(true)
        expect(live()).toHaveLength(1)
        act(() => void live()[0].say("still listening", true))
        expect(result.current.finalText).toBe("still listening")
    })

    it("queues a restart across the teardown instead of dropping the utterance", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => result.current.stop())
        // Re-pressed well inside the teardown — the window a push-to-talk chord lands in.
        act(() => result.current.start())
        expect(result.current.recording).toBe(true)

        act(() => vi.advanceTimersByTime(TEARDOWN_MS))
        act(() => vi.runOnlyPendingTimers())

        expect(live()).toHaveLength(1)
        act(() => void live()[0].say("second take", true))
        expect(result.current.finalText).toBe("second take")
    })

    it("retries a start the browser refuses rather than dying on the first refusal", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => result.current.stop())
        act(() => result.current.start())

        // Still closing, so the first relaunch attempt is refused too.
        act(() => vi.advanceTimersByTime(200))
        expect(live()).toHaveLength(0)
        expect(result.current.recording).toBe(true)
        expect(result.current.error).toBeNull()

        act(() => vi.advanceTimersByTime(TEARDOWN_MS))
        act(() => vi.runOnlyPendingTimers())
        expect(live()).toHaveLength(1)
    })

    it("gives up with a message when the recogniser never comes back", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => FakeRecognition.instances[0].endOnSilence())
        // Every subsequent attempt throws: nothing will ever open again.
        FakeRecognition.prototype.start = function () {
            throw new Error("InvalidStateError")
        }
        act(() => vi.advanceTimersByTime(60_000))

        expect(result.current.recording).toBe(false)
        expect(result.current.error).toBe("Voice input stopped unexpectedly")
    })

    it("reports whether a press actually opened a session", () => {
        const {result} = renderHook(() => useVoiceInput())
        let opened: boolean | undefined
        act(() => void (opened = result.current.start()))
        expect(opened).toBe(true)

        // Rendered state lags a press by a commit, so the caller cannot tell from `recording`
        // alone — a second press must report that it opened nothing.
        act(() => void (opened = result.current.start()))
        expect(opened).toBe(false)
        expect(FakeRecognition.instances).toHaveLength(1)
    })

    it("stops for a denied microphone and says so", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => FakeRecognition.instances[0].onerror?.({error: "not-allowed"}))

        expect(result.current.recording).toBe(false)
        expect(result.current.error).toBe("Microphone access denied")
    })

    it("rides out the errors that punctuate a long dictation", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => FakeRecognition.instances[0].onerror?.({error: "no-speech"}))
        act(() => FakeRecognition.instances[0].endOnSilence())
        act(() => vi.runOnlyPendingTimers())

        expect(result.current.recording).toBe(true)
        expect(result.current.error).toBeNull()
        expect(live()).toHaveLength(1)
    })

    it("abandons a queued restart when the mic is released again", () => {
        const {result} = renderHook(() => useVoiceInput())
        act(() => result.current.start())
        act(() => result.current.stop())
        act(() => result.current.start())
        act(() => result.current.stop())

        act(() => vi.advanceTimersByTime(60_000))
        expect(result.current.recording).toBe(false)
        expect(result.current.active).toBe(false)
        expect(live()).toHaveLength(0)
    })

    it("reports unsupported where the API is absent, and start is inert", () => {
        delete (window as any).SpeechRecognition
        delete (window as any).webkitSpeechRecognition
        const {result} = renderHook(() => useVoiceInput())
        expect(result.current.supported).toBe(false)
        act(() => result.current.start())
        expect(result.current.recording).toBe(false)
    })
})
