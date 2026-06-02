/**
 * Regression tests for AGE-3790: switching projects keeps evaluation/playground
 * in the URL.
 *
 * Bug: navigating to a new project while on an evaluation or playground (or any
 * entity-scoped page) kept the old project's entity ID in the URL. That entity
 * doesn't exist in the target project, so the user landed on an empty screen.
 *
 * Fix: when switching projects, preserve only the top-level section and drop any
 * nested entity IDs. The settings tab query param is the one exception that
 * carries over, since tabs exist across all projects.
 */
import {describe, expect, it} from "vitest"

import {buildProjectSwitchHref} from "./projectSwitchHref"

const WS = "ws-1"
const NEW_PROJECT = "proj-new"

describe("buildProjectSwitchHref", () => {
    it("drops the evaluation id and lands on the evaluations list", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/evaluations/results/eval-123",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/evaluations")
    })

    it("drops the single-model-test evaluation id", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/evaluations/single_model_test/eval-123",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/evaluations")
    })

    it("drops the app id and any deep playground sub-route to the apps list", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/apps/app-123/playground",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/apps")
    })

    it("drops the testset id and lands on the testsets list", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/testsets/testset-123",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/testsets")
    })

    it("keeps the top-level playground section as-is", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/playground",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/playground")
    })

    it("keeps the top-level observability section as-is", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/observability",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/observability")
    })

    it("falls back to apps when there is no section in the path", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/apps")
    })

    it("strips query params from non-settings pages", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/evaluations/results/compare?evaluations=a,b",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/evaluations")
    })

    it("preserves the settings tab query param", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/settings",
            settingsTab: "apikeys",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/settings?tab=apikeys")
    })

    it("ignores the default 'workspace' settings tab and falls back to the query tab", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/settings?tab=secrets",
            settingsTab: "workspace",
            queryTab: "secrets",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/settings?tab=secrets")
    })

    it("does not add a tab param for non-settings pages even if a tab is present", () => {
        const href = buildProjectSwitchHref({
            workspaceId: WS,
            projectId: NEW_PROJECT,
            currentAsPath: "/w/ws-1/p/proj-old/apps/app-123/traces",
            queryTab: "spans",
        })
        expect(href).toBe("/w/ws-1/p/proj-new/apps")
    })
})
