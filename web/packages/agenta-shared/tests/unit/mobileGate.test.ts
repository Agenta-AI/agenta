import {describe, expect, it} from "vitest"

import {mapDesktopToMobile, mobileRouteFor} from "../../src/utils/mobileGate"
import {SESSION_QUERY_PARAM} from "../../src/utils/sessionParam"

describe("mapDesktopToMobile", () => {
    it("maps /auth to the /m sign-in page", () => {
        expect(mapDesktopToMobile("/auth", "")).toBe("/m/auth")
        expect(mapDesktopToMobile("/auth/reset-password", "")).toBe("/m/auth/reset-password")
    })
    it("maps an observability session deep link to the mobile chat", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/observability", "?session=abc&span=s1")).toBe(
            "/m/w/ws1/p/pr1/sessions/abc",
        )
    })
    it("maps a project-scoped route to the mobile screen showing the same thing", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/apps/app1/playground", "?revisions=r1")).toBe(
            "/m/w/ws1/p/pr1/agents/app1",
        )
        expect(mapDesktopToMobile("/w/ws1/p/pr1/agents", "")).toBe("/m/w/ws1/p/pr1/agents")
    })
    it("sends a page /m does not have to the mobile root", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/testsets", "")).toBe("/m/")
        expect(mobileRouteFor("/w/ws1/p/pr1/testsets", "")).toBeNull()
    })
    it("keeps a website template link that opens the app root", () => {
        // The website CTA links to `/?template=`; the /m root then opens that template's setup.
        expect(mapDesktopToMobile("/", "?template=pr-reviewer")).toBe("/m/?template=pr-reviewer")
    })
    it("maps context-free routes to the mobile root resolver", () => {
        expect(mapDesktopToMobile("/w", "")).toBe("/m/")
        expect(mapDesktopToMobile("/w/ws1", "")).toBe("/m/")
        expect(mapDesktopToMobile("/settings", "")).toBe("/m/")
    })
})

describe("mapDesktopToMobile — URLs outside /m", () => {
    const legacy = (path: string) => {
        const url = new URL(path, "http://localhost")
        return mapDesktopToMobile(url.pathname, url.search, {developerViews: true})
    }
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
        ["/settings", "/m/"],
        ["/workspaces/accept?token=t&organization_id=o1", "/m/auth?token=t&organization_id=o1"],
        ["/workspaces/accept", "/m/invite"],
        ["/post-signup", "/m/"],
        ["/ws1/apps/app1", "/m/"],
        ["/no/such/page?secret=s", "/m/"],
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
        expect(legacy(path)).toBe(expected)
    })

    it("names no /m page for a path it sends to the root, so the proxy can log it", () => {
        expect(mobileRouteFor("/no/such/page", "", {developerViews: true})).toBeNull()
        expect(
            mobileRouteFor("/w/ws1/p/pr1/evaluations/results/run1", "", {developerViews: true}),
        ).toBe("/m/w/ws1/p/pr1/evaluations/results/run1")
    })
})

describe("mobileRouteFor", () => {
    const cases: [string, string, string | null][] = [
        // Home is /apps.
        ["/w/ws1/p/pr1", "", "/m/w/ws1/p/pr1/apps"],
        ["/w/ws1/p/pr1/apps", "", "/m/w/ws1/p/pr1/apps"],
        ["/w/ws1/p/pr1/agents", "", "/m/w/ws1/p/pr1/agents"],
        ["/w/ws1/p/pr1/agents/a1", "", "/m/w/ws1/p/pr1/agents/a1"],
        ["/w/ws1/p/pr1/sessions", "", "/m/w/ws1/p/pr1/sessions"],
        ["/w/ws1/p/pr1/observability", "", "/m/w/ws1/p/pr1/observability"],
        ["/w/ws1/p/pr1/settings", "", "/m/w/ws1/p/pr1/settings"],
        ["/w/ws1/p/pr1/settings", "?tab=preferences", "/m/w/ws1/p/pr1/settings?tab=preferences"],
        ["/w/ws1/p/pr1/settings", "?tab=billing", "/m/w/ws1/p/pr1/settings?tab=billing"],
        // The run-failure "Buy credits" link: /m opens the pack picker from Credits.
        [
            "/w/ws1/p/pr1/settings",
            "?tab=billing&buy_credits=1",
            "/m/w/ws1/p/pr1/settings?tab=credits&buy_credits=1",
        ],
        ["/w/ws1/p/pr1/apps/agent-templates", "", "/m/w/ws1/p/pr1/templates"],
        ["/w/ws1/p/pr1/apps/agent-templates/k1", "", "/m/w/ws1/p/pr1/templates/k1"],
        // Every app-scoped page collapses to the agent screen — the only one /m has.
        ["/w/ws1/p/pr1/apps/a1", "", "/m/w/ws1/p/pr1/agents/a1"],
        ["/w/ws1/p/pr1/apps/a1/overview", "", "/m/w/ws1/p/pr1/agents/a1"],
        ["/w/ws1/p/pr1/apps/a1/playground", "", "/m/w/ws1/p/pr1/agents/a1"],
        // Areas /m has no page for.
        ["/w/ws1/p/pr1/evaluations", "", null],
        ["/w/ws1/p/pr1/testsets", "", null],
        ["/w/ws1/p/pr1/prompts", "", null],
        ["/w/ws1/p/pr1/evaluators", "", null],
        ["/w/ws1/p/pr1/annotations", "", null],
        ["/w/ws1/p/pr1/apps/a1/variants", "", "/m/w/ws1/p/pr1/agents/a1"],
        // Archived lists are not agent ids, and /m has no archive.
        ["/w/ws1/p/pr1/apps/archived", "", null],
        ["/w/ws1/p/pr1/agents/archived", "", null],
        ["/settings", "", null],
        ["/workspaces/accept", "", "/m/invite"],
        // A website template link opens that template's setup step on /m.
        ["/w", "?template=pr-reviewer", "/m/?template=pr-reviewer"],
        [
            "/w/ws1/p/pr1/apps",
            "?template=pr-reviewer",
            "/m/w/ws1/p/pr1/agents/new?template=pr-reviewer",
        ],
        [
            "/w/ws1/p/pr1/apps",
            "?new=1&template=pr-reviewer",
            "/m/w/ws1/p/pr1/agents/new?template=pr-reviewer",
        ],
        ["/w/ws1/p/pr1", "?template=a%20b", "/m/w/ws1/p/pr1/agents/new?template=a%20b"],
        ["/w/ws1/p/pr1/apps", "?template=", "/m/w/ws1/p/pr1/apps"],
    ]

    it.each(cases)("maps %s → %s", (pathname, search, expected) => {
        expect(mobileRouteFor(pathname, search)).toBe(expected)
    })

    it("opens the linked session's chat, since /m has no playground route", () => {
        // The session page IS the playground there; ?agent= names the agent a session with no
        // turns cannot name for itself.
        expect(
            mobileRouteFor("/w/ws1/p/pr1/apps/a1/playground", `?${SESSION_QUERY_PARAM}=s1`),
        ).toBe("/m/w/ws1/p/pr1/sessions/s1?agent=a1")
    })
})
