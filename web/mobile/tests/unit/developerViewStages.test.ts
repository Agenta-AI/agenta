import {describe, expect, it} from "vitest"

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"

const idsAt = (stage: string) =>
    DEVELOPER_VIEWS.filter((view) => view.stage === stage)
        .map((view) => view.id)
        .sort()

describe("developer view stages", () => {
    it("lists exactly the views in preview, so a stage change shows in review", () => {
        expect(idsAt("preview")).toEqual([
            "annotation-queues",
            "archived-apps",
            "endpoints",
            "evaluators",
            "observability-app-filter",
            "prompts",
            "variants",
        ])
    })

    it("keeps no view on, and every other view hidden", () => {
        expect(idsAt("on")).toEqual([])
        expect(idsAt("hidden")).toEqual([
            "app-overview",
            "evaluations",
            "evaluator-playground",
            "observability-actions",
            "playground",
            "testsets",
        ])
    })

    it("gives every preview view with routes a link-ready first route and a nav entry", () => {
        for (const view of DEVELOPER_VIEWS.filter((entry) => entry.stage === "preview")) {
            if (!view.routes) {
                expect(view.nav).toBeUndefined()
                continue
            }
            expect(view.routes[0]).not.toContain("[")
            expect(view.nav?.section).toBe("developer")
        }
    })
})
