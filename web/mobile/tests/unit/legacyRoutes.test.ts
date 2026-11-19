import {SESSION_QUERY_PARAM} from "@agenta/shared/utils/sessionParam"
import {describe, expect, it} from "vitest"

import {legacyTarget} from "../../src/lib/legacyRoutes"

const P = "/w/ws/p/pr"
const M = "/m/w/ws/p/pr"
const route = (path: string, search = "") => {
    const {target, matched} = legacyTarget(path, search)
    return matched ? target : null
}
const map = (path: string) => {
    const url = new URL(path, "http://localhost")
    return legacyTarget(url.pathname, url.search).target
}

describe("legacyTarget: project and app pages", () => {
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
        [`${P}/agents/a1`, "", `${M}/agents/a1`],
        [`${P}/observability`, "", `${M}/observability`],
        [`${P}/apps/agent-templates`, "", `${M}/templates`],
    ]

    it.each(rows)("%s%s", (path, search, expected) => {
        expect(route(path, search)).toBe(expected)
    })

    it("a section named like an inherited object key is no app page", () => {
        for (const section of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
            expect(route(`${P}/apps/a1/${section}`)).toBe(`${M}/agents/a1`)
        }
    })

    it("keeps an agent session link on the session page", () => {
        expect(route(`${P}/apps/a1/playground`, `?${SESSION_QUERY_PARAM}=s1`)).toBe(
            `${M}/sessions/s1?agent=a1`,
        )
    })
})

describe("legacyTarget: links and the /m root", () => {
    const cases: [string, string][] = [
        // tracing.py builds this link for every SDK trace.
        ["/w/ws1/p/pr1/observability?trace=t1", "/m/w/ws1/p/pr1/observability?trace=t1"],
        [
            "/w/ws1/p/pr1/observability?trace=t1&span=s1&x=1",
            "/m/w/ws1/p/pr1/observability?trace=t1&span=s1",
        ],
        // evaluations/runs.py; no cookie is read, so a fresh browser lands on the run.
        ["/w/ws1/p/pr1/evaluations/results/run1", "/m/w/ws1/p/pr1/evaluations/results/run1"],
        // organization_service.py emails this link.
        ["/w/org1/p/pr1/settings?tab=workspace", "/m/w/org1/p/pr1/settings?tab=workspace"],
        ["/settings", "/m"],
        ["/workspaces/accept?token=t&organization_id=o1", "/m/auth?token=t&organization_id=o1"],
        ["/workspaces/accept", "/m/invite"],
        ["/post-signup", "/m"],
        ["/ws1/apps/app1", "/m"],
        ["/no/such/page?secret=s", "/m"],
        [
            "/auth?token=t&email=a%40b.c&organization_id=o&workspace_id=w&project_id=p",
            "/m/auth?token=t&email=a%40b.c&organization_id=o&workspace_id=w&project_id=p",
        ],
        ["/auth?auth_error=sso_required", "/m/auth?auth_error=sso_required"],
        [
            "/auth/reset-password?token=t&tenantId=public",
            "/m/auth/reset-password?token=t&tenantId=public",
        ],
        [
            "/auth/callback/sso:acme:okta?code=c&state=s",
            "/m/auth/callback/sso:acme:okta?code=c&state=s",
        ],
        ["/auth/verify-email?x=1", "/m/auth?x=1"],
    ]

    it.each(cases)("maps %s → %s", (path, expected) => {
        expect(map(path)).toBe(expected)
    })

    it("keeps a website template link that opens the app root", () => {
        expect(map("/?template=pr-reviewer")).toBe("/m?template=pr-reviewer")
        expect(route("/w/ws1/p/pr1/apps", "?template=pr-reviewer")).toBe(
            "/m/w/ws1/p/pr1/agents/new?template=pr-reviewer",
        )
        expect(route("/w/ws1/p/pr1/apps", "?template=")).toBe("/m/w/ws1/p/pr1/apps")
    })

    it("matches no page for a path it sends to the root", () => {
        expect(route("/no/such/page")).toBeNull()
        expect(route("/w/ws1/p/pr1/apps/archived")).toBeNull()
        expect(route("/w/ws1/p/pr1/agents/archived")).toBeNull()
    })
})
