import {describe, expect, it} from "vitest"

import {registerQuestion, TEAM_QUESTION, withTestQuestions} from "./onboardingTestQuestion"

import {
    guardOnboardingRoute as guardWith,
    nextStep,
    onboardingRoutePath,
    onboardingSteps,
    parseOnboardingRoute,
    progressIndex,
    progressSteps,
    stepIndex,
    type OnboardingRoute,
    type OnboardingStep,
} from "@/features/onboarding/onboardingRoute"

withTestQuestions()

const ALL: OnboardingStep[] = ["role", "source", "credits", "templates", "review"]
const guardOnboardingRoute = (
    route: OnboardingRoute | null,
    answers: Parameters<typeof guardWith>[1],
) => guardWith(route, answers, ALL)

const none = {answers: {}, templateKey: null}
const answered = {answers: {role: "Engineering", source: "GitHub"}, templateKey: null}
const picked = {...answered, templateKey: "review"}

describe("onboarding URL steps", () => {
    it("reads each step from the path after /onboarding", () => {
        expect(parseOnboardingRoute(["role"])).toEqual({step: "role"})
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

    it("names no step for the bare page, an unknown or an over-long path", () => {
        expect(parseOnboardingRoute([])).toBeNull()
        expect(parseOnboardingRoute(["gallery"])).toBeNull()
        expect(parseOnboardingRoute(["role", "extra"])).toBeNull()
        expect(parseOnboardingRoute(["review", "extra"])).toBeNull()
        expect(parseOnboardingRoute(["templates", "a", "b"])).toBeNull()
    })

    it("writes the path each step is read from", () => {
        expect(onboardingRoutePath({step: "role"})).toBe("role")
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
        expect(
            guardOnboardingRoute({step: "credits"}, {...none, answers: {role: "Engineering"}}),
        ).toEqual({step: "source"})
        expect(guardOnboardingRoute({step: "review"}, answered)).toEqual({
            step: "templates",
            focus: null,
        })
    })

    it("resumes the bare page or an unknown path at the furthest open step", () => {
        expect(guardOnboardingRoute(null, none)).toEqual({step: "role"})
        expect(guardOnboardingRoute(null, picked)).toEqual({step: "review"})
    })
})

describe("hidden question steps", () => {
    const noRole = ["source", "credits", "templates", "review"] as const
    const noQuestions = ["credits", "templates", "review"] as const

    it("drops a hidden step from the order, the dots and the next step", () => {
        expect(progressSteps(noRole)).toEqual(["source", "credits", "templates"])
        expect(progressIndex("review", noRole)).toBe(2)
        expect(nextStep("source", noRole)).toBe("credits")
    })

    it("opens later steps without the hidden question's answer", () => {
        expect(guardWith({step: "credits"}, none, noRole)).toEqual({step: "source"})
        const sourced = {...none, answers: {source: "GitHub"}}
        expect(guardWith({step: "credits"}, sourced, noRole)).toEqual({step: "credits"})
        expect(guardWith(null, none, noQuestions)).toEqual({step: "templates", focus: null})
        expect(guardWith({step: "role"}, none, noQuestions)).toEqual({
            step: "templates",
            focus: null,
        })
    })

    it("numbers steps for analytics by the whole registry, shown or not", () => {
        expect(onboardingSteps()).toEqual(ALL)
        registerQuestion({...TEAM_QUESTION, enabled: false})
        expect(onboardingSteps()).toEqual(ALL)
        const steps = ["role", "source", "team", "credits", "review"] as OnboardingStep[]
        expect(steps.map(stepIndex)).toEqual([0, 1, 2, 3, 5])
        expect(parseOnboardingRoute(["team"])).toEqual({step: "team"})
        expect(guardWith(parseOnboardingRoute(["team"]), answered, ALL)).toEqual({
            step: "templates",
            focus: null,
        })
    })
})
