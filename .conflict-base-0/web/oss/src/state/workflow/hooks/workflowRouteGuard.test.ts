import {describe, expect, it} from "vitest"

import type {RouteLayer} from "@/oss/state/appState"

import {shouldRunWorkflowRouteGuard} from "./workflowRouteGuard"

describe("shouldRunWorkflowRouteGuard", () => {
    it.each<RouteLayer>(["unknown", "root", "workspace", "project"])(
        "stops guarding after navigation reaches the %s layer",
        (routeLayer) => {
            expect(shouldRunWorkflowRouteGuard(routeLayer)).toBe(false)
        },
    )

    it("keeps guarding app-to-app navigation", () => {
        expect(shouldRunWorkflowRouteGuard("app")).toBe(true)
    })
})
