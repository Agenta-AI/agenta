// @vitest-environment jsdom
//
// The agent sidebar's Filter link: `?view=sessions&filters=open` opens the Sessions filter menu
// once on arrival, and the param leaves the address so a reload keeps the menu closed (A10).
import {act, renderHook} from "@testing-library/react"
import {beforeEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({
    pathname: "/w/[workspace_id]/p/[project_id]/agents/[agent_id]",
    query: {} as Record<string, string>,
    replace: vi.fn(),
}))
vi.mock("next/router", () => ({useRouter: () => router}))

const {useFiltersOpenOnArrival} = await import("@/features/sessions/useFiltersOpenOnArrival")

beforeEach(() => {
    router.replace.mockReset()
    router.query = {agent_id: "a1", view: "sessions"}
})

describe("useFiltersOpenOnArrival", () => {
    it("keeps the menu closed on the plain Sessions link", () => {
        const {result} = renderHook(() => useFiltersOpenOnArrival())
        expect(result.current[0]).toBe(false)
        expect(router.replace).not.toHaveBeenCalled()
    })

    it("opens the menu once and drops filters=open from the address", () => {
        router.query = {agent_id: "a1", view: "sessions", filters: "open"}
        const {result} = renderHook(() => useFiltersOpenOnArrival())
        expect(result.current[0]).toBe(true)
        expect(router.replace).toHaveBeenCalledWith(
            {pathname: router.pathname, query: {agent_id: "a1", view: "sessions"}},
            undefined,
            {shallow: true},
        )
        // The reader closes it; it stays closed.
        act(() => result.current[1](false))
        expect(result.current[0]).toBe(false)
    })
})
