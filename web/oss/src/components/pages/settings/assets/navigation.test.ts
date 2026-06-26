import {describe, expect, it} from "vitest"

import {resolveSettingsTab, type SettingsAccess} from "./navigation"

const baseAccess: SettingsAccess = {
    billingEnabled: true,
    canShowTools: true,
    canViewApiKeys: true,
    canViewEvents: true,
    isEE: true,
    isOwner: true,
}

describe("resolveSettingsTab", () => {
    it("falls back to workspace for unknown tabs", () => {
        expect(resolveSettingsTab("unknown", baseAccess)).toBe("workspace")
    })

    it("falls back to workspace when a tab is hidden", () => {
        expect(resolveSettingsTab("apiKeys", {...baseAccess, canViewApiKeys: false})).toBe(
            "workspace",
        )
    })

    it("requires organization owner access consistently", () => {
        expect(resolveSettingsTab("organization", {...baseAccess, isOwner: false})).toBe(
            "workspace",
        )
    })

    it("keeps valid tabs that are not shown in the sidebar", () => {
        expect(resolveSettingsTab("projects", baseAccess)).toBe("projects")
    })
})
