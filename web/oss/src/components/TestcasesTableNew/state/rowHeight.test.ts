import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

import {TESTCASE_ROW_HEIGHT_CONFIG, testcaseRowHeightAtom} from "./rowHeight"

describe("TESTCASE_ROW_HEIGHT_CONFIG", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it("defaults to small row height so more rows fit in compact views", () => {
        expect(TESTCASE_ROW_HEIGHT_CONFIG.defaultSize).toBe("small")
        expect(TESTCASE_ROW_HEIGHT_CONFIG.sizes.small.height).toBe(80)
    })

    it("initializes testcaseRowHeightAtom to small when no preference is stored", () => {
        const store = createStore()
        expect(store.get(testcaseRowHeightAtom)).toBe("small")
    })
})
