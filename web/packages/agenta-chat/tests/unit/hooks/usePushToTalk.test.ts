// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PUSH_TO_TALK_ARM_MS, usePushToTalk} from "../../../src/hooks/usePushToTalk"

/**
 * The composer's push-to-talk chord (hold Ctrl+Option / Ctrl+Alt to dictate).
 *
 * The negative cases carry the weight here. That chord IS AltGr on European layouts and
 * VoiceOver's VO modifier on macOS, so the guards that keep it from eating `@`, `{`, or a VO
 * command — the arm delay, cancel-on-any-other-key, and left-Alt-only — are the point of it.
 */

/** The chord's own keys report both modifiers as down by the time the second one lands. */
const chordInit: KeyboardEventInit = {ctrlKey: true, altKey: true, bubbles: true, cancelable: true}

const holdChord = (code = "AltLeft") =>
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Alt", code, ...chordInit}))

const releaseChord = (key = "Alt") =>
    document.dispatchEvent(new KeyboardEvent("keyup", {key, bubbles: true, cancelable: true}))

const pressWithin = (key: string, code: string) =>
    document.dispatchEvent(new KeyboardEvent("keydown", {key, code, ...chordInit}))

const waitOutArmDelay = () =>
    act(() => {
        vi.advanceTimersByTime(PUSH_TO_TALK_ARM_MS)
    })

const setup = (enabled = true) => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    // The mic's own root, as the composer mounts it — the hook reads it to tell a session on
    // screen from one the chat surface keeps mounted behind `display: none`.
    const root = document.createElement("div")
    document.body.append(root)
    const rootRef = {current: root}
    const view = renderHook(() => usePushToTalk({enabled, rootRef, onStart, onStop}))
    return {onStart, onStop, view, root}
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
})

describe("usePushToTalk", () => {
    it("opens the mic once the chord has been held long enough", () => {
        const {onStart} = setup()
        holdChord()
        expect(onStart).not.toHaveBeenCalled()
        waitOutArmDelay()
        expect(onStart).toHaveBeenCalledTimes(1)
    })

    it("ignores a tap shorter than the arm delay", () => {
        const {onStart, onStop} = setup()
        holdChord()
        act(() => {
            vi.advanceTimersByTime(PUSH_TO_TALK_ARM_MS - 1)
        })
        releaseChord()
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
        expect(onStop).not.toHaveBeenCalled()
    })

    it("cancels when another key joins the hold, so AltGr keeps typing", () => {
        const {onStart} = setup()
        holdChord()
        pressWithin("q", "KeyQ")
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("stops an open mic when another key joins the hold", () => {
        const {onStop} = setup()
        holdChord()
        waitOutArmDelay()
        pressWithin("h", "KeyH")
        expect(onStop).toHaveBeenCalledTimes(1)
    })

    it("leaves the right-hand Alt alone, since that is the physical AltGr", () => {
        const {onStart} = setup()
        holdChord("AltRight")
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("closes the mic when either modifier is released, once", () => {
        const {onStop} = setup()
        holdChord()
        waitOutArmDelay()
        releaseChord("Control")
        expect(onStop).toHaveBeenCalledTimes(1)
        releaseChord("Alt")
        expect(onStop).toHaveBeenCalledTimes(1)
    })

    it("does not arm on Alt alone", () => {
        const {onStart} = setup()
        document.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Alt", code: "AltLeft", altKey: true}),
        )
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("ignores the OS auto-repeat stream while the chord is held", () => {
        const {onStart} = setup()
        holdChord()
        waitOutArmDelay()
        holdChord()
        waitOutArmDelay()
        expect(onStart).toHaveBeenCalledTimes(1)
    })

    it("closes the mic when the window loses focus mid-hold", () => {
        const {onStop} = setup()
        holdChord()
        waitOutArmDelay()
        act(() => {
            window.dispatchEvent(new Event("blur"))
        })
        expect(onStop).toHaveBeenCalledTimes(1)
    })

    it("yields to an open dialog", () => {
        const {onStart} = setup()
        const modal = document.createElement("div")
        modal.className = "ant-modal-wrap"
        document.body.append(modal)
        holdChord()
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("yields to a dialog that opens during the arm delay", () => {
        const {onStart} = setup()
        holdChord()
        act(() => {
            vi.advanceTimersByTime(PUSH_TO_TALK_ARM_MS - 1)
        })
        const modal = document.createElement("div")
        modal.className = "ant-modal-wrap"
        document.body.append(modal)
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("stays out of it for a session that is mounted but off screen", () => {
        const {onStart, root} = setup()
        root.style.display = "none"
        holdChord()
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("yields when the session is switched away during the arm delay", () => {
        const {onStart, root} = setup()
        holdChord()
        act(() => {
            vi.advanceTimersByTime(PUSH_TO_TALK_ARM_MS - 1)
        })
        root.style.display = "none"
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("does nothing while disabled", () => {
        const {onStart} = setup(false)
        holdChord()
        waitOutArmDelay()
        expect(onStart).not.toHaveBeenCalled()
    })

    it("closes an open mic on unmount", () => {
        const {onStop, view} = setup()
        holdChord()
        waitOutArmDelay()
        act(() => view.unmount())
        expect(onStop).toHaveBeenCalledTimes(1)
    })
})
