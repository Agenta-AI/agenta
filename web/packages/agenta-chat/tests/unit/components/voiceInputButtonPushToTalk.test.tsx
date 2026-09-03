/**
 * @vitest-environment jsdom
 *
 * The mic's push-to-talk chord across the sessions a chat surface keeps mounted.
 *
 * A visited session stays in the tree behind `display: none`, so its mic hears the same
 * document-level chord as the one on screen. Both answering it means two recognisers racing for
 * the single microphone, and the composer in view is as likely to lose as to win — which reads as
 * dictation capturing nothing at all.
 */
import {act, cleanup, render} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import VoiceInputButton from "../../../src/components/VoiceInputButton"
import {PUSH_TO_TALK_ARM_MS} from "../../../src/hooks/usePushToTalk"

const started: string[] = []
const stopped: string[] = []
/** The live session, so a test can hold back `onend` the way a real browser teardown does. */
let live: FakeRecognition | null = null

class FakeRecognition {
    continuous = false
    interimResults = false
    lang = ""
    onstart: (() => void) | null = null
    onresult: ((e: unknown) => void) | null = null
    onerror: ((e: {error: string}) => void) | null = null
    onend: (() => void) | null = null
    start() {
        started.push("start")
        live = this
        this.onstart?.()
    }
    /** Stopping only ASKS; the browser closes the session on its own schedule (see `onend`). */
    stop() {
        stopped.push("stop")
    }
    abort() {
        this.onend?.()
    }
}

const holdChord = () =>
    document.dispatchEvent(
        new KeyboardEvent("keydown", {
            key: "Alt",
            code: "AltLeft",
            ctrlKey: true,
            altKey: true,
            bubbles: true,
        }),
    )

const waitOutArmDelay = () =>
    act(() => {
        vi.advanceTimersByTime(PUSH_TO_TALK_ARM_MS)
    })

const releaseChord = () =>
    document.dispatchEvent(new KeyboardEvent("keyup", {key: "Alt", bubbles: true}))

const inputRef = {current: null}

const renderMic = (
    onDictatingChange: (active: boolean) => void = () => {},
    stopRef?: {current: () => void},
) =>
    render(
        <VoiceInputButton
            inputRef={inputRef}
            onStartAudio={() => {}}
            audioSupported={false}
            audioPending={false}
            audioPerceivable={null}
            attachmentsFull={false}
            onDictationError={() => {}}
            onDictatingChange={onDictatingChange}
            stopRef={stopRef}
        />,
    )

beforeEach(() => {
    started.length = 0
    stopped.length = 0
    live = null
    vi.useFakeTimers()
    ;(window as unknown as {SpeechRecognition: unknown}).SpeechRecognition = FakeRecognition
})

afterEach(() => {
    vi.useRealTimers()
    cleanup()
})

describe("VoiceInputButton push-to-talk", () => {
    it("opens the mic for the session on screen", () => {
        renderMic()
        holdChord()
        waitOutArmDelay()
        expect(started).toHaveLength(1)
    })

    it("leaves the chord alone in a session that is mounted but hidden", () => {
        const {container} = renderMic()
        ;(container.firstElementChild as HTMLElement).style.display = "none"
        holdChord()
        waitOutArmDelay()
        expect(started).toHaveLength(0)
    })

    it("opens exactly one mic when a hidden session is mounted alongside the visible one", () => {
        const hidden = renderMic()
        ;(hidden.container.firstElementChild as HTMLElement).style.display = "none"
        renderMic()
        holdChord()
        waitOutArmDelay()
        expect(started).toHaveLength(1)
    })

    it("unlocks the composer on release, without waiting out the browser's teardown", () => {
        const onDictatingChange = vi.fn()
        renderMic(onDictatingChange)
        holdChord()
        waitOutArmDelay()
        expect(onDictatingChange).toHaveBeenLastCalledWith(true)

        // Released, but the recogniser has not closed its session yet — the composer must not
        // stay read-only across a teardown that can run for seconds.
        act(() => {
            releaseChord()
        })
        expect(onDictatingChange).toHaveBeenLastCalledWith(false)

        act(() => {
            live?.onend?.()
        })
        expect(onDictatingChange).toHaveBeenLastCalledWith(false)
    })

    it("hands the composer a stopper, so a send closes the mic it opened", () => {
        const onDictatingChange = vi.fn()
        const stopRef = {current: () => {}}
        renderMic(onDictatingChange, stopRef)
        holdChord()
        waitOutArmDelay()
        expect(onDictatingChange).toHaveBeenLastCalledWith(true)

        // What the composer runs on submit, with the chord still held.
        act(() => stopRef.current())
        expect(stopped).toHaveLength(1)
        expect(onDictatingChange).toHaveBeenLastCalledWith(false)
    })
})
