import {describe, expect, it} from "vitest"

import {mobileSessionListPolicy} from "../../src/features/sessions/sessionListPolicy"

describe("mobile session list policy", () => {
    it("deliberately includes all origins without expansions", () => {
        expect(mobileSessionListPolicy).toEqual({
            origins: undefined,
            excludeOrigins: undefined,
            expand: [],
        })
    })
})
