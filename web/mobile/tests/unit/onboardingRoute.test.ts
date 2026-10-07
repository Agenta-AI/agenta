import {describe, expect, it} from "vitest"

import {
    activeOnboardingSteps,
    guardOnboardingRoute as guardWith,
    nextStep,
    onboardingRoutePath,
    parseOnboardingRoute,
    progressIndex,
    progressSteps,
    type OnboardingRoute,
} from "@/features/onboarding/onboardingRoute"

const ALL = activeOnboardingSteps({role: true, source: true})
const guardOnboardingRoute = (
    route: OnboardingRoute | null,
    answers: Parameters<typeof guardWith>[1],
) => guardWith(route, answers, ALL)

const none = {role: null, source: null, templateKey: null}
const answered = {role: "Engineering", source: "GitHub", templateKey: null} as const
const picked = {...answered, templateKey: "review"}

describe("onboarding URL steps", () => {
    it("reads each step from the path after /onboarding", () => {
        expect(parseOnboardingRoute([])).toEqual({step: "role"})
        expect(parseOnboardingRoute(["source"])).toEqual({step: "source"})
        expect(parseOnboardingRoute(["credits"])).toEqual({step: "credits"})
        expect(parseOnboardingRoute(["templates"])).toEqual({step: "templates", focus: null})
        expect(parseOnboardingRoute(["templates", "scratch"])).toEqual({
            step: "templates",
            focus: {kind: "scratch"},
        })
        expect(parseOnboardingRoute(["templates", "pr-reviewer"])).toEqual({
            step: "templates",
            focus: {kind: "template", key: "pr-reviewer"},
        })
        expect(parseOnboardingRoute(["review"])).toEqual({step: "review"})
    })

    it("names no step for an unknown or over-long path", () => {
        expect(parseOnboardingRoute(["role"])).toBeNull()
        expect(parseOnboardingRoute(["gallery"])).toBeNull()
        expect(parseOnboardingRoute(["review", "extra"])).toBeNull()
        expect(parseOnboardingRoute(["templates", "a", "b"])).toBeNull()
    })

    it("writes the path each step is read from", () => {
        expect(onboardingRoutePath({step: "role"})).toBe("")
        expect(onboardingRoutePath({step: "credits"})).toBe("credits")
        expect(onboardingRoutePath({step: "templates", focus: null})).toBe("templates")
        expect(onboardingRoutePath({step: "templates", focus: {kind: "scratch"}})).toBe(
            "templates/scratch",
        )
        expect(
            onboardingRoutePath({step: "templates", focus: {kind: "template", key: "a b"}}),
        ).toBe("templates/a%20b")
    })
})

describe("onboarding step guard", () => {
    it("keeps a step the answers open", () => {
        const route = {step: "templates", focus: {kind: "template", key: "x"}} as const
        expect(guardOnboardingRoute(route, answered)).toEqual(route)
        expect(guardOnboardingRoute({step: "review"}, picked)).toEqual({step: "review"})
    })

    it("sends a step not yet reached to the furthest one the answers open", () => {
        expect(guardOnboardingRoute({step: "review"}, none)).toEqual({step: "role"})
        expect(guardOnboardingRoute({step: "credits"}, {...none, role: "Engineering"})).toEqual({
            step: "source",
        })
        expect(guardOnboardingRoute({step: "review"}, answered)).toEqual({
            step: "templates",
            focus: null,
        })
    })

    it("sends an unknown path to the furthest open step", () => {
        expect(guardOnboardingRoute(null, none)).toEqual({step: "role"})
        expect(guardOnboardingRoute(null, picked)).toEqual({step: "review"})
    })
})

describe("hidden question steps", () => {
    const noRole = activeOnboardingSteps({role: false, source: true})
    const noQuestions = activeOnboardingSteps({role: false, source: false})

    it("drops a hidden step from the order, the dots and the next step", () => {
        expect(noRole).toEqual(["source", "credits", "templates", "review"])
        expect(progressSteps(noRole)).toEqual(["source", "credits", "templates"])
        expect(progressIndex("review", noRole)).toBe(2)
        expect(nextStep("source", noRole)).toBe("credits")
    })

    it("opens later steps without the hidden question's answer", () => {
        expect(guardWith({step: "credits"}, none, noRole)).toEqual({step: "source"})
        expect(guardWith({step: "credits"}, {...none, source: "GitHub"}, noRole)).toEqual({
            step: "credits",
        })
        expect(guardWith(null, none, noQuestions)).toEqual({step: "templates", focus: null})
        expect(guardWith({step: "role"}, none, noQuestions)).toEqual({
            step: "templates",
            focus: null,
        })
    })
})
