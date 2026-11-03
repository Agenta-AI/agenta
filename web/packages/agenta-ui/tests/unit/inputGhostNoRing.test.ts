import {describe, expect, it} from "vitest"

import {inputVariants} from "../../src/components/ui/input"

/**
 * A borderless field sits inside a frame that is its visual edge (the session search palette's
 * row). Since the focus ring became a class both apps generate, a borderless field on the default
 * variant drew a 3px ring box on focus. The ghost variant is the one to use there: no border and
 * no focus ring.
 */
describe("the ghost Input", () => {
    it("draws no focus ring and no focus border", () => {
        const classes = inputVariants({variant: "ghost"}).split(/\s+/)
        expect(classes.filter((c) => c.startsWith("focus-within:"))).toEqual([])
        expect(classes).toContain("border-transparent")
    })

    it("leaves the ring on the bordered default", () => {
        const classes = inputVariants({variant: "default"}).split(/\s+/)
        expect(classes).toContain("focus-within:ring-[3px]")
    })
})
