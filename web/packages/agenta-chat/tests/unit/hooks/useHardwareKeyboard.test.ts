import {renderHook} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {useHardwareKeyboard} from "../../../src/hooks/useHardwareKeyboard"

/** Stand in for `matchMedia`, recording what was asked and letting a test answer it. */
const stubMatchMedia = (matches: boolean) => {
    const listeners = new Set<() => void>()
    const queries: string[] = []
    const fn = vi.fn((query: string) => {
        queries.push(query)
        return {
            matches,
            media: query,
            addEventListener: (_: string, cb: () => void) => listeners.add(cb),
            removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
            addListener: (cb: () => void) => listeners.add(cb),
            removeListener: (cb: () => void) => listeners.delete(cb),
        } as unknown as MediaQueryList
    })
    vi.stubGlobal("matchMedia", fn)
    Object.defineProperty(window, "matchMedia", {value: fn, configurable: true, writable: true})
    return {queries, listeners}
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe("useHardwareKeyboard", () => {
    it("reports a keyboard on a pointer device", () => {
        stubMatchMedia(false)
        const {result} = renderHook(() => useHardwareKeyboard())
        expect(result.current).toBe(true)
    })

    it("reports no keyboard on a touch-only screen", () => {
        stubMatchMedia(true)
        const {result} = renderHook(() => useHardwareKeyboard())
        expect(result.current).toBe(false)
    })

    it("asks for hover AND pointer, so a touchscreen laptop keeps its shortcuts", () => {
        // `pointer: coarse` alone matches a device that also has a keyboard. Width would be worse
        // still: a narrow desktop window can type, a large tablet cannot.
        const {queries} = stubMatchMedia(false)
        renderHook(() => useHardwareKeyboard())
        expect(queries[0]).toBe("(hover: none) and (pointer: coarse)")
    })

    it("keeps the hints when the device cannot be classified", () => {
        // No `matchMedia` at all (older browsers, some test environments). Showing a hint nobody
        // can use is a smaller harm than hiding one that works.
        Object.defineProperty(window, "matchMedia", {value: undefined, configurable: true})
        const {result} = renderHook(() => useHardwareKeyboard())
        expect(result.current).toBe(true)
    })
})
