// @vitest-environment jsdom
import * as React from "react"

import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {THEME_STORAGE_KEY, useThemeMode} from "../../src/theme/useThemeMode"

const Probe = () => {
    useThemeMode()
    return null
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.localStorage.clear()
    document.documentElement.className = ""
})

describe("useThemeMode on a dark page load", () => {
    // The boot script sets `.dark` before React; removing it even once paints a light frame.
    it("never drops the boot script's dark class while it reads the stored mode", () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify("dark"))
        document.documentElement.classList.add("dark")
        const lost: string[] = []
        const original = DOMTokenList.prototype.toggle
        vi.spyOn(DOMTokenList.prototype, "toggle").mockImplementation(function (
            this: DOMTokenList,
            token: string,
            force?: boolean,
        ) {
            const result = original.call(this, token, force)
            if (token === "dark" && !result) lost.push(token)
            return result
        })
        render(<Probe />)
        expect(lost).toEqual([])
    })
})
