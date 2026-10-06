import {describe, expect, it} from "vitest"

import {probeHasSessions} from "../../src/features/sessions/useProjectHasSessions"

/**
 * The sessions screen swaps the list for onboarding when the project has no session at all. A
 * failed probe used to read as "no sessions", so a network error put onboarding over a project
 * full of them. Failed is unknown, and only a settled empty answer is empty.
 */

type Probe = Parameters<typeof probeHasSessions>[0]
type Pages = NonNullable<NonNullable<Probe["data"]>["pages"]>

const page = (ids: string[]) => ({sessions: ids.map((id) => ({id}))}) as unknown as Pages[number]

describe("probeHasSessions", () => {
    it("is true when the probe found a session", () => {
        expect(probeHasSessions({isError: false, data: {pages: [page(["s-1"])]}})).toBe(true)
    })

    it("is false when the probe answered with nothing", () => {
        expect(probeHasSessions({isError: false, data: {pages: [page([])]}})).toBe(false)
    })

    it("is unknown when the probe failed", () => {
        expect(probeHasSessions({isError: true})).toBeUndefined()
    })

    it("keeps a session it already found when a later refetch fails", () => {
        expect(probeHasSessions({isError: true, data: {pages: [page(["s-1"])]}})).toBe(true)
    })
})
