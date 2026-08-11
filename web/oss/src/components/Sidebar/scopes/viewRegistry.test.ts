import {describe, expect, it, vi} from "vitest"

// The registry's `create` functions pull in the scope components, and with them next/font —
// which needs the Next build pipeline. Matching itself is pure.
vi.mock("next/font/google", () => ({
    Inter: () => ({className: "", variable: "", style: {fontFamily: "Inter"}}),
}))

import {
    MAIN_SIDEBAR_SCOPE_ID,
    SETTINGS_SIDEBAR_SCOPE_ID,
    WORKFLOW_SIDEBAR_SCOPE_ID,
} from "./constants"
import {resolveSidebarView, type SidebarViewMatchContext} from "./viewRegistry"

const ctx = (overrides: Partial<SidebarViewMatchContext> = {}): SidebarViewMatchContext => ({
    pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground",
    routeLayer: "app",
    agentState: "unknown",
    ...overrides,
})

describe("resolveSidebarView", () => {
    it("keeps the project rail on an agent's own pages", () => {
        expect(resolveSidebarView(ctx({agentState: "agent"})).id).toBe(MAIN_SIDEBAR_SCOPE_ID)
    })

    it("swaps to the app-context rail for a classic app or evaluator", () => {
        expect(resolveSidebarView(ctx({agentState: "non-agent"})).id).toBe(
            WORKFLOW_SIDEBAR_SCOPE_ID,
        )
    })

    it("holds the app-context rail while agent-ness is unknown", () => {
        expect(resolveSidebarView(ctx({currentViewId: WORKFLOW_SIDEBAR_SCOPE_ID})).id).toBe(
            WORKFLOW_SIDEBAR_SCOPE_ID,
        )
    })

    it("falls back to the project rail when unknown with no rail to hold", () => {
        expect(resolveSidebarView(ctx()).id).toBe(MAIN_SIDEBAR_SCOPE_ID)
        expect(resolveSidebarView(ctx({currentViewId: MAIN_SIDEBAR_SCOPE_ID})).id).toBe(
            MAIN_SIDEBAR_SCOPE_ID,
        )
    })

    it("lets settings win over the held rail", () => {
        const view = resolveSidebarView(
            ctx({
                pathname: "/w/[workspace_id]/p/[project_id]/settings",
                routeLayer: "project",
                currentViewId: WORKFLOW_SIDEBAR_SCOPE_ID,
            }),
        )
        expect(view.id).toBe(SETTINGS_SIDEBAR_SCOPE_ID)
    })

    it("ignores agent-ness outside an app route", () => {
        expect(resolveSidebarView(ctx({routeLayer: "project", agentState: "non-agent"})).id).toBe(
            MAIN_SIDEBAR_SCOPE_ID,
        )
    })
})
