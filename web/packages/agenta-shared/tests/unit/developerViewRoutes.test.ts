import {describe, expect, it} from "vitest"

import {mobileRouteFor} from "../../src/utils/mobileGate"
import {SESSION_QUERY_PARAM} from "../../src/utils/sessionParam"

const P = "/w/ws/p/pr"
const M = "/m/w/ws/p/pr"
const BETA = {developerViews: true}

describe("mobileRouteFor with developer views", () => {
    const rows: [string, string, string | null][] = [
        [`${P}/apps/a1`, "", `${M}/apps/a1/overview`],
        [`${P}/apps/a1/overview`, "", `${M}/apps/a1/overview`],
        [`${P}/apps/a1/playground`, "?revisions=r1", `${M}/apps/a1/playground?revisions=r1`],
        [
            `${P}/apps/a1/playground`,
            "?revisions=a%2Cb&x=1",
            `${M}/apps/a1/playground?revisions=a%2Cb`,
        ],
        [`${P}/apps/a1/playground`, "", `${M}/apps/a1/playground`],
        [`${P}/apps/a1/variants`, "?revisions=r1", `${M}/apps/a1/variants`],
        [`${P}/apps/a1/variants`, "", `${M}/apps/a1/variants`],
        [`${P}/apps/a1/variants`, "?tab=deployments", `${M}/apps/a1/variants?tab=deployments`],
        [`${P}/apps/a1/deployments`, "", `${M}/apps/a1/variants?tab=deployments`],
        [`${P}/apps/a1/endpoints`, "", `${M}/apps/a1/endpoints`],
        [`${P}/apps/a1/traces`, "", `${M}/apps/a1/traces`],
        [`${P}/apps/a1/evaluations`, "", `${M}/apps/a1/evaluations`],
        [`${P}/apps/a1/evaluations/results/e1`, "", `${M}/evaluations/results/e1`],
        [`${P}/apps/a1/evaluations/results/compare`, "", null],
        [`${P}/apps/a1/sessions`, "", `${M}/agents/a1`],
        [`${P}/prompts`, "", `${M}/prompts`],
        [`${P}/evaluations`, "", `${M}/evaluations`],
        [`${P}/evaluations/results/e1`, "", `${M}/evaluations/results/e1`],
        [`${P}/evaluations/results/compare`, "", null],
        [`${P}/testsets`, "", `${M}/testsets`],
        [`${P}/testsets/t1`, "", `${M}/testsets/t1`],
        [`${P}/testsets/archived`, "", `${M}/testsets/archived`],
        [`${P}/evaluators`, "", `${M}/evaluators`],
        [`${P}/evaluators/archived`, "", `${M}/evaluators/archived`],
        [`${P}/evaluators/playground`, "", null],
        [`${P}/annotations/q1`, "", `${M}/annotations/q1`],
        // Unchanged by the option.
        [`${P}/agents/a1`, "", `${M}/agents/a1`],
        [`${P}/observability`, "", `${M}/observability`],
        [`${P}/apps/agent-templates`, "", `${M}/templates`],
    ]

    it.each(rows)("%s%s", (path, search, expected) => {
        expect(mobileRouteFor(path, search, BETA)).toBe(expected)
    })

    it("a section named like an inherited object key is no app page", () => {
        for (const section of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
            expect(mobileRouteFor(`${P}/apps/a1/${section}`, "", BETA)).toBe(`${M}/agents/a1`)
        }
    })

    it("keeps an agent session link on the session page", () => {
        expect(mobileRouteFor(`${P}/apps/a1/playground`, `?${SESSION_QUERY_PARAM}=s1`, BETA)).toBe(
            `${M}/sessions/s1?agent=a1`,
        )
    })

    it("without the option every app page still collapses to the agent screen", () => {
        for (const section of ["overview", "playground", "variants", "endpoints", "traces"]) {
            expect(mobileRouteFor(`${P}/apps/a1/${section}`, "")).toBe(`${M}/agents/a1`)
        }
        expect(mobileRouteFor(`${P}/prompts`, "")).toBeNull()
        expect(mobileRouteFor(`${P}/testsets`, "")).toBeNull()
    })
})
