// @vitest-environment jsdom
import {
    activeUserIdAtom,
    betaDeveloperModeFlagAtom,
    navSimplifiedOverrideAtom,
} from "@agenta/shared/state"
import {createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {enabledDeveloperViewsAtom} from "@/features/developer/developerViewAccess"
import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"

// The real registry on purpose: beta developer mode must turn on every view that ships.
const store = (beta: boolean) => {
    const s = createStore()
    s.set(activeUserIdAtom, "u1")
    s.set(navSimplifiedOverrideAtom, false)
    s.set(betaDeveloperModeFlagAtom, beta)
    return s
}

beforeEach(() => {
    vi.stubGlobal("__env", {NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE: "true"})
})
afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
})

describe("beta developer mode is the one gate", () => {
    it("turns on every developer view, including the ones every cross link checks", () => {
        const ids = store(true)
            .get(enabledDeveloperViewsAtom)
            ?.map((view) => view.id)
        expect(ids).toEqual(DEVELOPER_VIEWS.map((view) => view.id))
        for (const id of [
            "app-overview",
            "playground",
            "evaluator-playground",
            "evaluations",
            "variants",
            "testsets",
            "evaluators",
            "annotation-queues",
            "endpoints",
            "observability-app-filter",
            "observability-actions",
        ])
            expect(ids).toContain(id)
    })

    it("with beta off turns on no view", () => {
        expect(store(false).get(enabledDeveloperViewsAtom)).toEqual([])
    })
})
