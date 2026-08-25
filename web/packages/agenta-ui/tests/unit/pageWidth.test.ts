import {describe, expect, it} from "vitest"

import {pageGutterClass} from "../../src/components/pageWidth"

describe("pageGutterClass", () => {
    it("collapses side padding below lg the way the sessions screen already does", () => {
        expect(pageGutterClass).toContain("px-4")
        expect(pageGutterClass).toContain("lg:px-16")
        expect(pageGutterClass.split(/\s+/)).not.toContain("px-16")
    })
})
