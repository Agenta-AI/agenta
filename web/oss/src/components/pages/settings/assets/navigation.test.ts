import {describe, expect, it} from "vitest"

import {
    getSettingsSidebarTabs,
    getSettingsTabDescription,
    resolveSettingsTab,
    SETTINGS_SCOPES,
    SETTINGS_TABS,
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

    it("keeps the organizations tab reachable for members, not just owners", () => {
        // It lists every organization you belong to; ownership only gates the row actions.
        expect(resolveSettingsTab("organizationGeneral", {...baseAccess, isEE: false})).toBe(
            "organizationGeneral",
        )
        expect(resolveSettingsTab("organizationGeneral", {...baseAccess, isOwner: false})).toBe(
            "organizationGeneral",
        )
    })

    it("gates tools and triggers independently", () => {
        expect(resolveSettingsTab("tools", {...baseAccess, canShowTools: false})).toBe("workspace")
        expect(resolveSettingsTab("triggers", {...baseAccess, canShowTriggers: false})).toBe(
            "workspace",
        )
    })

    it("keeps personal preferences available in OSS", () => {
        const ossAccess = {...baseAccess, isEE: false, isOwner: false}

        expect(resolveSettingsTab("preferences", ossAccess)).toBe("preferences")
        expect(resolveSettingsTab("account", ossAccess)).toBe("workspace")
    })
})

describe("settings tab descriptions", () => {
    it("gives every tab a non-empty description", () => {
        const missing = SETTINGS_TABS.filter(
            ({key}) => !getSettingsTabDescription(key, baseAccess).trim(),
        ).map(({key}) => key)

        expect(missing).toEqual([])
    })

    it("keeps descriptions short enough to stay scannable", () => {
        // The header subtitle is a summary, not documentation — anything longer than this
        // belongs behind the docs link. Longest today is 113 characters.
        const tooLong = SETTINGS_TABS.filter(
            ({key}) => getSettingsTabDescription(key, baseAccess).length > 140,
        ).map(({key}) => key)

        expect(tooLong).toEqual([])
    })

    it("varies the billing description with the billing entitlement", () => {
        expect(getSettingsTabDescription("billing", baseAccess)).toContain("subscription")
        expect(
            getSettingsTabDescription("billing", {...baseAccess, billingEnabled: false}),
        ).not.toContain("subscription")
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
            "mcpEndpoints",
        ])
        expect(keysForScope("organization")).toEqual([
            "organizationGeneral",
            "workspace",
            "projects",
            "organization",
            "auditLog",
            "billing",
        ])
        expect(keysForScope("personal")).toEqual(["account", "preferences"])
    })
})
