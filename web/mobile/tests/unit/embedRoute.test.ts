import {describe, expect, it} from "vitest"

import {isEmbedPath} from "../../src/features/embed/embedRoute"

describe("isEmbedPath", () => {
    it("matches the widget route with and without the /m base path", () => {
        expect(isEmbedPath("/embed/[embedId]")).toBe(true)
        expect(isEmbedPath("/m/embed/abc")).toBe(true)
        expect(isEmbedPath("/embed")).toBe(true)
    })

    it("leaves every other route on the full app layout", () => {
        expect(isEmbedPath("/")).toBe(false)
        expect(isEmbedPath("/embedded")).toBe(false)
        expect(isEmbedPath("/m/w/a/p/b/sessions/embed")).toBe(false)
        expect(isEmbedPath("/m/embeds/abc")).toBe(false)
    })
})
