// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest"

import type {InstanceLicense} from "@/features/settings/licenseApi"
import {licenseNotices} from "@/features/settings/LicenseNotices"
import {forgetLicenseKey, peekLicenseKey, takeLicenseLinkKey} from "@/lib/context"

const NOW = Date.parse("2026-11-09T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000

const license = (expiresInDays: number | null, users = 3, seats: number | null = 10) =>
    ({
        plan: "self_hosted_enterprise",
        source: "database",
        license: {
            key_id: "0967fbac-5eeb-48ec-b469-fce211cf67ad",
            plan: "self_hosted_enterprise",
            customer: "Acme",
            seats,
            issued_at: "2026-01-01T00:00:00Z",
            expires_at:
                expiresInDays === null ? null : new Date(NOW + expiresInDays * DAY).toISOString(),
            telemetry: "required",
        },
        usage: {users},
    }) satisfies InstanceLicense

describe("license notices for the instance admin", () => {
    it("say nothing far from expiry and within seats", () => {
        expect(licenseNotices(license(60), NOW)).toEqual([])
        expect(licenseNotices(license(null), NOW)).toEqual([])
    })

    it("warn from 30 days before expiry", () => {
        const notices = licenseNotices(license(10), NOW)
        expect(notices).toHaveLength(1)
        expect(notices[0]).toMatch(/^This license expires on /)
    })

    it("say an expired key left the instance on the Community plan", () => {
        const notices = licenseNotices(license(-1, 20), NOW)
        expect(notices).toHaveLength(1)
        expect(notices[0]).toMatch(/expired on .*Community plan\.$/)
    })

    it("warn when users exceed the seats", () => {
        expect(licenseNotices(license(60, 12), NOW)).toEqual([
            "This instance has 12 users, more than the license allows (10 seats).",
        ])
        expect(licenseNotices(license(60, 2, 1), NOW)).toEqual([
            "This instance has 2 users, more than the license allows (1 seat).",
        ])
        expect(licenseNotices(license(60, 12, null), NOW)).toEqual([])
    })
})

describe("the activation link key", () => {
    afterEach(() => {
        forgetLicenseKey()
        window.history.replaceState(null, "", "/")
    })

    it("moves from the address bar into session storage", () => {
        window.history.replaceState(null, "", "/m/settings?tab=license#key=agenta_license_v1.a.b")

        takeLicenseLinkKey()

        expect(window.location.hash).toBe("")
        expect(window.location.search).toBe("?tab=license")
        expect(peekLicenseKey()).toBe("agenta_license_v1.a.b")
    })
})
