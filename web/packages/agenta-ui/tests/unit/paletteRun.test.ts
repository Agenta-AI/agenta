import {describe, expect, it} from "vitest"

import {isSameRun, readRun, runPatternFor} from "../../src/RichChatInput/assets/palette"

const FILE_RUN = runPatternFor("@", true)
const COMMAND_RUN = runPatternFor("/", false)

const readFile = (text: string) => readRun(text, FILE_RUN)

describe("runPatternFor('@')", () => {
    it("opens on a bare `@` starting the text", () => {
        expect(readFile("@")).toEqual({query: "", start: 0, afterSpace: false})
    })

    it("opens on an `@` following a space, mid-message", () => {
        expect(readFile("summarise @guide")).toEqual({query: "guide", start: 10, afterSpace: true})
    })

    it("keeps a path in one run, unlike the `/` palette", () => {
        expect(readFile("@docs/guide")?.query).toBe("docs/guide")
        expect(readRun("/docs/guide", COMMAND_RUN)).toBeNull()
    })

    it("stays shut on an email address mid-sentence", () => {
        expect(readFile("email me at hey@agenta.ai")).toBeNull()
    })

    it("closes once the run ends in whitespace", () => {
        expect(readFile("@guide ")).toBeNull()
    })

    it("reports the last run when the caret sits after a second trigger", () => {
        expect(readFile("@one @two")).toEqual({query: "two", start: 5, afterSpace: true})
    })
})

describe("isSameRun", () => {
    it("separates the same position in two different palettes", () => {
        expect(
            isSameRun(
                {palette: "slash", nodeKey: "1", start: 0},
                {palette: "files", nodeKey: "1", start: 0},
            ),
        ).toBe(false)
    })

    it("matches the same position in the same palette", () => {
        expect(
            isSameRun(
                {palette: "files", nodeKey: "1", start: 4},
                {palette: "files", nodeKey: "1", start: 4},
            ),
        ).toBe(true)
    })
})
