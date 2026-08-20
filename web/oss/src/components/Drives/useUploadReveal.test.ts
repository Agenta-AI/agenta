import {describe, expect, it} from "vitest"

import {ruleOnBatch, type UploadBatch} from "./useUploadReveal"

const batch = (over: Partial<UploadBatch> = {}): UploadBatch => ({
    key: "k",
    paths: ["agent-files/agenta/hosting/.env.ee.dev"],
    at: 0,
    sawFetch: false,
    ...over,
})
const DIR = "agent-files/agenta/hosting"

const rule = (over: Parameters<typeof ruleOnBatch>[0]) => ruleOnBatch(over).verdict

describe("ruleOnBatch", () => {
    it("confirms a batch whose file is in the listing", () => {
        expect(
            rule({
                batch: batch(),
                seen: new Set(["agent-files/agenta/hosting/.env.ee.dev"]),
                loadedDirs: new Set([DIR]),
                fetchingDirs: new Set(),
                now: 10_000,
            }),
        ).toBe("confirmed")
    })

    it("waits while the destination listing is still refetching", () => {
        expect(
            rule({
                batch: batch({sawFetch: true}),
                seen: new Set(),
                loadedDirs: new Set([DIR]),
                fetchingDirs: new Set([DIR]),
                now: 5_000,
            }),
        ).toBe("waiting")
    })

    it("waits out the settle floor when no refetch was ever observed", () => {
        const args = {
            batch: batch(),
            seen: new Set<string>(),
            loadedDirs: new Set([DIR]),
            fetchingDirs: new Set<string>(),
        }
        expect(rule({...args, now: 300})).toBe("waiting")
        expect(rule({...args, now: 1_500})).toBe("filtered")
    })

    it("rules immediately once the observed refetch has settled", () => {
        expect(
            rule({
                batch: batch({sawFetch: true}),
                seen: new Set(),
                loadedDirs: new Set([DIR]),
                fetchingDirs: new Set(),
                now: 400,
            }),
        ).toBe("filtered")
    })

    it("never rules on a directory it has not loaded — it gives up instead", () => {
        const args = {
            batch: batch(),
            seen: new Set<string>(),
            loadedDirs: new Set<string>(),
            fetchingDirs: new Set<string>(),
        }
        expect(rule({...args, now: 2_000})).toBe("waiting")
        expect(rule({...args, now: 6_000})).toBe("unresolved")
    })

    it("carries sawFetch forward once the refetch has been seen", () => {
        const seen = ruleOnBatch({
            batch: batch(),
            seen: new Set(),
            loadedDirs: new Set([DIR]),
            fetchingDirs: new Set([DIR]),
            now: 100,
        })
        expect(seen).toEqual({verdict: "waiting", sawFetch: true})
    })

    it("treats a root-level upload as living in the root directory", () => {
        expect(
            rule({
                batch: batch({paths: [".env"]}),
                seen: new Set(),
                loadedDirs: new Set([""]),
                fetchingDirs: new Set(),
                now: 2_000,
            }),
        ).toBe("filtered")
    })
})
