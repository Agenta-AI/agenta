import {describe, expect, it, vi} from "vitest"

// The registry's `create` functions reach next/font, which needs the Next build pipeline.
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
    agentTypeSettled: false,
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

    it("settles a failed lookup on the app-context rail instead of stranding it", () => {
        expect(resolveSidebarView(ctx({agentTypeSettled: true})).id).toBe(WORKFLOW_SIDEBAR_SCOPE_ID)
    })

    it("settles the same way from the project rail, so the swap still happens", () => {
        expect(
            resolveSidebarView(ctx({agentTypeSettled: true, currentViewId: MAIN_SIDEBAR_SCOPE_ID}))
                .id,
        ).toBe(WORKFLOW_SIDEBAR_SCOPE_ID)
    })

    it("does not settle while the lookup can still answer", () => {
        expect(resolveSidebarView(ctx({agentTypeSettled: false})).id).toBe(MAIN_SIDEBAR_SCOPE_ID)
    })

    it("keeps a known agent on the project rail once its lookup settles", () => {
        expect(resolveSidebarView(ctx({agentState: "agent", agentTypeSettled: true})).id).toBe(
            MAIN_SIDEBAR_SCOPE_ID,
        )
    })

    it("never settles a non-app route onto the app-context rail", () => {
        expect(resolveSidebarView(ctx({routeLayer: "project", agentTypeSettled: true})).id).toBe(
            MAIN_SIDEBAR_SCOPE_ID,
        )
    })
})
