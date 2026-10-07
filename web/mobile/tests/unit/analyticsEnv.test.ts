// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest"

import {getEnv} from "@/lib/env"

afterEach(() => {
    delete window.__env
    vi.unstubAllEnvs()
})

describe("analytics runtime configuration", () => {
    it("reads the container's existing public PostHog key", () => {
        window.__env = {NEXT_PUBLIC_POSTHOG_API_KEY: "runtime-test-key"}
        expect(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")).toBe("runtime-test-key")
    })

    it("does not fall back to a build key when runtime configuration explicitly disables tracking", () => {
        vi.stubEnv("NEXT_PUBLIC_POSTHOG_API_KEY", "build-test-key")
        window.__env = {NEXT_PUBLIC_POSTHOG_API_KEY: ""}
        expect(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")).toBe("")
    })

    it("defaults to no tracking when no key is configured", () => {
        vi.stubEnv("NEXT_PUBLIC_POSTHOG_API_KEY", "")
        expect(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")).toBe("")
    })
})
