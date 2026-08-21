import {useEffect, useRef} from "react"

import {isMacPlatform} from "@agenta/shared/utils"

/** How long the chord must be held before the mic opens. */
export const PUSH_TO_TALK_ARM_MS = 300

/** Modifier key names that keep a held chord alive rather than breaking it. */
const CHORD_KEYS = new Set(["Control", "Alt", "AltGraph"])

/** True while an antd confirm/modal or a Radix dialog owns the screen. No global open-dialog state
 * exists to ask, and these dialogs come from `modal.confirm`, so the DOM is the only witness. */
const isOverlayOpen = (): boolean =>
    Boolean(
        document.querySelector(
            '.ant-modal-wrap:not([style*="display: none"]), [role="dialog"][data-state="open"]',
        ),
    )

export interface UsePushToTalkParams {
    enabled: boolean
    onStart: () => void
    onStop: () => void
}

/**
 * Push-to-talk: hold Ctrl+Option (macOS) or Ctrl+Alt (Windows/Linux) to dictate, release to stop.
 *
 * Ctrl+Alt IS AltGr on European layouts — it is how you type `@ { } [ ] €` — and it is VoiceOver's
 * VO modifier on macOS, so three guards keep the chord from eating characters or VO commands:
 * it arms only after {@link PUSH_TO_TALK_ARM_MS} (a tap does nothing), any other key pressed during
 * the hold cancels it (`AltGr+Q`, `VO+H`), and on non-Apple platforms only the LEFT Alt binds
 * (physical AltGr is `AltRight`). Nothing is `preventDefault`ed for the same reason.
 *
 * Lives with the mic rather than the app's session shortcuts because dictation state lives here;
 * the app-layer shortcut hook it would otherwise join has no caller since the package carve.
 */
export function usePushToTalk({enabled, onStart, onStop}: UsePushToTalkParams) {
    // The handlers change every render; keeping them in refs means the listeners register once.
    const onStartRef = useRef(onStart)
    const onStopRef = useRef(onStop)
    onStartRef.current = onStart
    onStopRef.current = onStop

    useEffect(() => {
        if (!enabled) return

        let armTimer: ReturnType<typeof setTimeout> | null = null
        let active = false
        const macPlatform = isMacPlatform()

        const disarm = () => {
            if (armTimer === null) return
            clearTimeout(armTimer)
            armTimer = null
        }
        const release = () => {
            disarm()
            if (!active) return
            active = false
            onStopRef.current()
        }

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.isComposing) return
            // Any keystroke that isn't the bare chord ends the hold — that's the AltGr and VoiceOver
            // escape hatch, since both are the chord plus a character key.
            if (!e.ctrlKey || !e.altKey || e.metaKey || e.shiftKey || !CHORD_KEYS.has(e.key)) {
                release()
                return
            }
            if (e.repeat) return
            // AltGr is the right-hand Alt everywhere it exists; binding the left one leaves it free.
            if (!macPlatform && e.code === "AltRight") return
            if (armTimer !== null || active) return
            if (isOverlayOpen()) return

            armTimer = setTimeout(() => {
                armTimer = null
                active = true
                onStartRef.current()
            }, PUSH_TO_TALK_ARM_MS)
        }

        const onKeyUp = (e: KeyboardEvent) => {
            if (CHORD_KEYS.has(e.key)) release()
        }
        // A keyup never arrives if the window loses focus mid-hold (⌘-Tab), which would otherwise
        // strand the mic open for good.
        const onVisibility = () => {
            if (document.visibilityState === "hidden") release()
        }

        document.addEventListener("keydown", onKeyDown, true)
        document.addEventListener("keyup", onKeyUp, true)
        document.addEventListener("visibilitychange", onVisibility)
        window.addEventListener("blur", release)
        return () => {
            document.removeEventListener("keydown", onKeyDown, true)
            document.removeEventListener("keyup", onKeyUp, true)
            document.removeEventListener("visibilitychange", onVisibility)
            window.removeEventListener("blur", release)
            release()
        }
    }, [enabled])
}
