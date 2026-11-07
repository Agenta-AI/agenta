// @vitest-environment jsdom
import {renderHook} from "@testing-library/react"
import {describe, expect, it} from "vitest"

import {useHasOpened} from "../../src/hooks/useHasOpened"

describe("useHasOpened", () => {
    it("stays false until the first open, then stays true", () => {
        const {result, rerender} = renderHook(({open}) => useHasOpened(open), {
            initialProps: {open: false},
        })
        expect(result.current).toBe(false)

        rerender({open: true})
        expect(result.current).toBe(true)

        rerender({open: false})
        expect(result.current).toBe(true)
    })

    it("is true on the first render when already open", () => {
        const {result} = renderHook(() => useHasOpened(true))
        expect(result.current).toBe(true)
    })
})
