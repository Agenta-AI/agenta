import {describe, expect, it} from "vitest"

import type {Notice, Release} from "../../src/releases"
import {isSnoozeActive, SECURITY_WARNING_SNOOZE_MS} from "../../src/releases/dismissed"
import {
    compareVersions,
    latestSecurityRelease,
    mergeReleases,
    newerReleases,
    noticeApplies,
    parseNotices,
} from "../../src/releases/feed"

const release = (id: string, extra: Partial<Release> = {}): Release => ({
    id,
    date: "2026-01-01",
    features: [{id: `entry-${id}`, title: id, body: "", link: "https://agenta.ai/docs"}],
    improvements: [],
    fixes: [],
    ...extra,
})

const notice = (extra: Partial<Notice> = {}): Notice => ({
    id: "notice",
    title: "Title",
    body: "Body",
    link: "https://agenta.ai/docs",
    severity: "info",
    ...extra,
})

const instance = {version: "v0.128.5", edition: "oss" as const, plan: "self_hosted_community"}

describe("compareVersions", () => {
    it("compares by number, not as text", () => {
        expect(compareVersions("v0.128.10", "v0.128.9")).toBeGreaterThan(0)
        expect(compareVersions("v0.99.0", "v0.128.0")).toBeLessThan(0)
        expect(compareVersions("v1.0.0", "v0.200.200")).toBeGreaterThan(0)
        expect(compareVersions("v0.128.1", "v0.128.1")).toBe(0)
    })

    it("refuses a value that is not a version", () => {
        expect(() => compareVersions("0.128.1", "v0.128.1")).toThrow()
    })
})

describe("mergeReleases", () => {
    const bundled = [release("v0.127.3"), release("v0.127.2")]

    it("shows a newer release from the feed, newest first", () => {
        const merged = mergeReleases(bundled, [release("v0.128.1"), release("v0.128.0")])
        expect(merged.map((r) => r.id)).toEqual(["v0.128.1", "v0.128.0", "v0.127.3", "v0.127.2"])
    })

    it("does not duplicate a release the build already has, and keeps the bundled copy", () => {
        const feedCopy = release("v0.127.3", {date: "2030-01-01"})
        const merged = mergeReleases(bundled, [feedCopy, release("v0.128.0")])
        expect(merged.map((r) => r.id)).toEqual(["v0.128.0", "v0.127.3", "v0.127.2"])
        expect(merged[1]).toBe(bundled[0])
    })

    it("returns the bundled list as is when the feed is missing or empty", () => {
        expect(mergeReleases(bundled)).toBe(bundled)
        expect(mergeReleases(bundled, [])).toBe(bundled)
    })

    it("drops feed entries it cannot render", () => {
        const merged = mergeReleases(bundled, [
            {id: "v0.129.0"},
            "v0.130.0",
            null,
            release("latest"),
            release("v0.131.0", {features: []}),
        ])
        expect(merged).toBe(bundled)
    })

    it("drops a release with a bad item, a link that is not https or an oversized body", () => {
        const feature = release("v0.129.0").features[0]
        const merged = mergeReleases(bundled, [
            release("v0.129.0", {fixes: [null as never]}),
            release("v0.129.1", {improvements: [{area: "x"} as never]}),
            release("v0.129.2", {features: [{...feature, link: "javascript:alert(1)"}]}),
            release("v0.129.3", {features: [{...feature, link: "http://agenta.ai"}]}),
            release("v0.129.4", {features: [{...feature, body: "x".repeat(20_001)}]}),
            release("v0.129.5", {features: [{...feature, streamVideoId: "../x"}]}),
            release("v0.130.0"),
        ])
        expect(merged.map((r) => r.id)).toEqual(["v0.130.0", "v0.127.3", "v0.127.2"])
    })
})

describe("newerReleases", () => {
    const releases = [release("v0.128.1"), release("v0.128.0"), release("v0.127.3")]

    it("lists the releases above the running version", () => {
        expect(newerReleases(releases, "v0.127.3").map((r) => r.id)).toEqual([
            "v0.128.1",
            "v0.128.0",
        ])
    })

    it("lists nothing on the newest version (cloud)", () => {
        expect(newerReleases(releases, "v0.128.1")).toEqual([])
    })

    it("lists nothing when the version is unknown (route off or failed)", () => {
        expect(newerReleases(releases, null)).toEqual([])
        expect(newerReleases(releases, "unknown")).toEqual([])
    })
})

describe("latestSecurityRelease", () => {
    const releases = [
        release("v0.129.0"),
        release("v0.128.2", {securityFix: true}),
        release("v0.128.0", {securityFix: true}),
        release("v0.127.0"),
    ]

    it("names the newest security release the running version lacks", () => {
        expect(latestSecurityRelease(releases, "v0.127.0")?.id).toBe("v0.128.2")
        expect(latestSecurityRelease(releases, "v0.128.1")?.id).toBe("v0.128.2")
    })

    it("is null once the running version has the fix", () => {
        expect(latestSecurityRelease(releases, "v0.128.2")).toBeNull()
        expect(latestSecurityRelease(releases, "v0.129.0")).toBeNull()
    })

    it("is null when the version is unknown", () => {
        expect(latestSecurityRelease(releases, null)).toBeNull()
    })
})

describe("noticeApplies", () => {
    it("shows a notice with no filters everywhere", () => {
        expect(noticeApplies(notice(), instance)).toBe(true)
    })

    it("hides a notice outside its version range", () => {
        expect(noticeApplies(notice({minVersion: "v0.128.6"}), instance)).toBe(false)
        expect(noticeApplies(notice({maxVersion: "v0.128.4"}), instance)).toBe(false)
    })

    it("shows a notice inside its inclusive version range", () => {
        expect(
            noticeApplies(notice({minVersion: "v0.128.5", maxVersion: "v0.128.5"}), instance),
        ).toBe(true)
    })

    it("hides a version-bound notice when the version is unknown", () => {
        expect(noticeApplies(notice({minVersion: "v0.1.0"}), {...instance, version: null})).toBe(
            false,
        )
    })

    it("matches editions and plans", () => {
        const trial = notice({plans: ["self_hosted_community"]})
        expect(noticeApplies(trial, instance)).toBe(true)
        expect(noticeApplies(trial, {...instance, plan: "cloud_v0_pro"})).toBe(false)
        expect(noticeApplies(trial, {...instance, plan: null})).toBe(false)
        expect(noticeApplies(notice({editions: ["ee"]}), instance)).toBe(false)
        expect(noticeApplies(notice({editions: ["oss", "ee"]}), instance)).toBe(true)
    })
})

describe("parseNotices", () => {
    it("keeps well-formed notices and drops the rest", () => {
        const good = notice()
        expect(
            parseNotices([
                good,
                {...good, severity: "critical"},
                {...good, link: "javascript:alert(1)"},
                {...good, minVersion: "0.1"},
                "notice",
            ]),
        ).toEqual([good])
    })
})

describe("isSnoozeActive", () => {
    const now = 1_800_000_000_000

    it("stays closed for seven days after it was closed", () => {
        const stored = {id: "v0.128.2", at: now - SECURITY_WARNING_SNOOZE_MS + 1}
        expect(isSnoozeActive({stored, releaseId: "v0.128.2", now})).toBe(true)
    })

    it("comes back after seven days", () => {
        const stored = {id: "v0.128.2", at: now - SECURITY_WARNING_SNOOZE_MS}
        expect(isSnoozeActive({stored, releaseId: "v0.128.2", now})).toBe(false)
    })

    it("shows at once for a newer security release", () => {
        const stored = {id: "v0.128.2", at: now}
        expect(isSnoozeActive({stored, releaseId: "v0.129.1", now})).toBe(false)
    })

    it("shows when nothing or garbage is stored", () => {
        expect(isSnoozeActive({stored: null, releaseId: "v0.128.2", now})).toBe(false)
        expect(isSnoozeActive({stored: "x", releaseId: "v0.128.2", now})).toBe(false)
    })
})
