import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"

import {describe, expect, it} from "vitest"

import {DURATION, EASE_IN, EASE_IN_OUT, EASE_OUT} from "../../src/styles/motion"

const css = readFileSync(
    fileURLToPath(new URL("../../src/styles/motion.css", import.meta.url)),
    "utf8",
)

const token = (name: string) => {
    const match = css.match(new RegExp(`${name}:\\s*([^;]+);`))
    if (!match) throw new Error(`${name} is not defined in motion.css`)
    return match[1].trim()
}

const bezier = (curve: readonly number[]) => `cubic-bezier(${curve.join(", ")})`

describe("motion tokens", () => {
    it("JS curves match motion.css", () => {
        expect(token("--ease-out")).toBe(bezier(EASE_OUT))
        expect(token("--ease-in")).toBe(bezier(EASE_IN))
        expect(token("--ease-in-out")).toBe(bezier(EASE_IN_OUT))
    })

    it("JS durations match motion.css", () => {
        for (const [name, seconds] of Object.entries(DURATION)) {
            expect(token(`--transition-duration-${name}`)).toBe(`${Math.round(seconds * 1000)}ms`)
        }
    })
})
