// @vitest-environment jsdom
import {activeUserIdAtom, navSimplifiedOverrideAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {afterEach, describe, expect, it} from "vitest"

import {
    developerViewPreviewSwitchesAtom,
    enabledDeveloperViewsAtom,
} from "@/features/developer/developerViewAccess"
import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"

// The real registry on purpose: Developer Mode must turn on every view that ships.
const store = (developerMode: boolean) => {
    const s = createStore()
    s.set(activeUserIdAtom, "u1")
    s.set(navSimplifiedOverrideAtom, !developerMode)
    return s
}

afterEach(() => {
    localStorage.clear()
})

describe("Developer Mode is the one gate", () => {
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

    it("shows no Preferences switches", () => {
        expect(store(true).get(developerViewPreviewSwitchesAtom)).toEqual([])
    })

    it("with Developer Mode off keeps the stages and one switch per preview view", () => {
        const s = store(false)
        const ids = s.get(enabledDeveloperViewsAtom)?.map((view) => view.id)
        expect(ids).toEqual(DEVELOPER_VIEWS.filter((v) => v.stage === "on").map((v) => v.id))
        expect(ids).not.toContain("app-overview")
        expect(s.get(developerViewPreviewSwitchesAtom).map(({view}) => view.id)).toEqual(
            DEVELOPER_VIEWS.filter((v) => v.stage === "preview").map((v) => v.id),
        )
    })
})
