// @vitest-environment jsdom
/**
 * "Copy share link" on a plain-HTTP origin (QA D2): `navigator.clipboard` is undefined outside a
 * secure context. The copy must not throw or log an error (the Next dev overlay shows a logged
 * error as a runtime error); it falls back to selecting the text and `execCommand("copy")`, and
 * answers false only when that fails too.
 */
import {afterEach, describe, expect, it, vi} from "vitest"

import {copyToClipboard} from "../../src/utils/copyToClipboard"

const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, "clipboard", {value, configurable: true})

afterEach(() => {
    vi.restoreAllMocks()
    setClipboard(undefined)
})

describe("copyToClipboard", () => {
    it("without the clipboard API it copies through a selected text area", async () => {
        setClipboard(undefined)
        const exec = vi.fn(() => true)
        ;(document as unknown as {execCommand: unknown}).execCommand = exec
        const error = vi.spyOn(console, "error")

        await expect(copyToClipboard("https://example.test/m/x")).resolves.toBe(true)
        expect(exec).toHaveBeenCalledWith("copy")
        expect(error).not.toHaveBeenCalled()
        expect(document.querySelector("textarea")).toBeNull()
    })

    it("answers false, with no thrown or logged error, when no way to copy works", async () => {
        setClipboard(undefined)
        ;(document as unknown as {execCommand: unknown}).execCommand = vi.fn(() => false)
        const error = vi.spyOn(console, "error")

        await expect(copyToClipboard("https://example.test/m/x")).resolves.toBe(false)
        expect(error).not.toHaveBeenCalled()
    })

    it("a rejected clipboard write falls back too", async () => {
        setClipboard({writeText: vi.fn(() => Promise.reject(new Error("denied")))})
        const exec = vi.fn(() => true)
        ;(document as unknown as {execCommand: unknown}).execCommand = exec

        await expect(copyToClipboard("x")).resolves.toBe(true)
        expect(exec).toHaveBeenCalledWith("copy")
    })
})
