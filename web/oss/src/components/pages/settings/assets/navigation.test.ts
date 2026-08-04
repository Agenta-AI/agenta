import {describe, expect, it} from "vitest"

import {
    getSettingsSidebarTabs,
    resolveSettingsTab,
    SETTINGS_SCOPES,
    type SettingsAccess,
} from "./navigation"

const baseAccess: SettingsAccess = {
    billingEnabled: true,
    canShowTools: true,
    canShowTriggers: true,
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

    it("keeps the projects tab reachable", () => {
        expect(resolveSettingsTab("projects", baseAccess)).toBe("projects")
    })

    it("gives organization owners the general tab in both editions", () => {
        expect(resolveSettingsTab("organizationGeneral", {...baseAccess, isEE: false})).toBe(
            "organizationGeneral",
        )
        expect(resolveSettingsTab("organizationGeneral", {...baseAccess, isOwner: false})).toBe(
            "workspace",
        )
    })

    it("gates tools and triggers independently", () => {
        expect(resolveSettingsTab("tools", {...baseAccess, canShowTools: false})).toBe("workspace")
        expect(resolveSettingsTab("triggers", {...baseAccess, canShowTriggers: false})).toBe(
            "workspace",
        )
    })

    it("keeps personal feature flags available in OSS", () => {
        const ossAccess = {...baseAccess, isEE: false, isOwner: false}

        expect(resolveSettingsTab("featureFlags", ossAccess)).toBe("featureFlags")
        expect(resolveSettingsTab("account", ossAccess)).toBe("workspace")
    })
})

describe("settings sidebar scopes", () => {
    it("groups tabs by project, organization, and personal scope", () => {
        expect(SETTINGS_SCOPES.map(({key}) => key)).toEqual(["project", "organization", "personal"])

        const tabs = getSettingsSidebarTabs(baseAccess)
        const keysForScope = (scope: (typeof SETTINGS_SCOPES)[number]["key"]) =>
            tabs.filter((tab) => tab.scope === scope).map(({key}) => key)

        expect(keysForScope("project")).toEqual([
            "apiKeys",
            "secrets",
            "llms",
            "tools",
            "triggers",
            "webhooks",
        ])
        expect(keysForScope("organization")).toEqual([
            "organizationGeneral",
            "workspace",
            "projects",
            "organization",
            "auditLog",
            "billing",
        ])
        expect(keysForScope("personal")).toEqual(["account", "featureFlags"])
    })
})
