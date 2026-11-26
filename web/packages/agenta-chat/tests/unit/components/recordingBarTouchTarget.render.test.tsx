/**
 * @vitest-environment jsdom
 *
 * The recording bar on a phone: Delete is drawn 36 px with a 44 px touch area, like Send beside
 * it, and the two exits sit 8 px apart so their areas do not overlap.
 */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {PHONE_TOUCH_TARGET_CLASS} from "@agenta/ui/ui"

import RecordingBar from "../../../src/components/RecordingBar"
import type {AudioRecorder} from "../../../src/hooks/useAudioRecorder"

vi.mock("../../../src/components/RecordingWaveform", () => ({default: () => null}))

const recorder = {
    analyserRef: {current: null},
    startedAtRef: {current: Date.now()},
    stop: vi.fn(),
    cancel: vi.fn(),
} as unknown as AudioRecorder

const classesOf = (element: Element) => new Set(element.className.split(/\s+/))

afterEach(cleanup)

describe("RecordingBar on a phone", () => {
    it("gives Delete the 36 px size and the 44 px touch area of the composer buttons", () => {
        render(<RecordingBar recorder={recorder} willSend />)
        const remove = classesOf(screen.getByRole("button", {name: "Delete recording"}))
        expect(remove.has("max-md:size-9")).toBe(true)
        for (const token of PHONE_TOUCH_TARGET_CLASS.split(" "))
            expect(remove.has(token)).toBe(true)
    })

    it("puts the two exits 8 px apart on a phone", () => {
        const {container} = render(<RecordingBar recorder={recorder} willSend />)
        const row = [...container.querySelectorAll("div")].find((div) =>
            classesOf(div).has("max-md:gap-2"),
        )
        expect(row?.contains(screen.getByRole("button", {name: "Delete recording"}))).toBe(true)
    })
})
