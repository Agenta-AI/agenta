// @vitest-environment jsdom
import {act} from "react"

import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const analytics = vi.hoisted(() => ({key: "phc_test", capture: vi.fn()}))

vi.mock("@/lib/env", () => ({getEnv: () => analytics.key}))
vi.mock("@/features/analytics/client", async () => {
    const {atom} = await import("jotai")
    return {posthogAtom: atom<unknown>(null), capture: analytics.capture}
})

import {posthogAtom} from "@/features/analytics/client"
import type {OnboardingVariant} from "@/features/onboarding/onboardingChoices"
import {
    ONBOARDING_FLAG_TIMEOUT_MS,
    useOnboardingExperiment,
    type OnboardingAssignment,
} from "@/features/onboarding/useOnboardingExperiment"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

interface FakePostHog {
    getFeatureFlag: ReturnType<typeof vi.fn>
    onFeatureFlags: ReturnType<typeof vi.fn>
    unsubscribe: ReturnType<typeof vi.fn>
    notify: () => void
}

const fakePostHog = (flag?: string): FakePostHog => {
    const client: FakePostHog = {
        getFeatureFlag: vi.fn(() => flag),
        onFeatureFlags: vi.fn((callback: () => void) => {
            client.notify = callback
            return client.unsubscribe
        }),
        unsubscribe: vi.fn(),
        notify: () => undefined,
    }
    return client
}

let root: Root | undefined
let latest: OnboardingAssignment | null = null

const Probe = ({preview}: {preview: OnboardingVariant | null}) => {
    latest = useOnboardingExperiment(preview)
    return null
}

const mount = (preview: OnboardingVariant | null = null) => {
    const host = document.createElement("div")
    root = createRoot(host)
    act(() => root!.render(<Probe preview={preview} />))
}

const setClient = (client: FakePostHog | null) =>
    act(() => getDefaultStore().set(posthogAtom, client as never))

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    latest = null
    analytics.key = "phc_test"
    analytics.capture.mockReset()
    setClient(null)
    vi.useRealTimers()
})

describe("onboarding experiment", () => {
    it("previews a forced variant without enrolling", () => {
        setClient(fakePostHog("control"))
        mount("task-first")
        expect(latest).toEqual({variant: "task-first", enrolled: false})
        expect(analytics.capture).not.toHaveBeenCalled()
    })

    it.each(["control", "task-first"])("enrolls the visitor in the PostHog %s variant", (flag) => {
        setClient(fakePostHog(flag))
        mount()
        expect(latest).toEqual({variant: flag, enrolled: true})
        expect(analytics.capture).toHaveBeenCalledExactlyOnceWith("onboarding_started", {
            variant: flag,
        })
    })

    it("falls back to name first at once when analytics is not configured", () => {
        analytics.key = ""
        mount()
        expect(latest).toEqual({variant: "control", enrolled: false})
    })

    it("falls back to name first, unenrolled, when PostHog never answers", () => {
        vi.useFakeTimers()
        mount()
        expect(latest).toBeNull()
        act(() => vi.advanceTimersByTime(ONBOARDING_FLAG_TIMEOUT_MS))
        expect(latest).toEqual({variant: "control", enrolled: false})
    })

    it("waits for flags to load, then freezes the first assignment", () => {
        const client = fakePostHog()
        mount()
        setClient(client)
        expect(latest).toBeNull()
        client.getFeatureFlag.mockReturnValue("task-first")
        act(() => client.notify())
        client.getFeatureFlag.mockReturnValue("control")
        act(() => client.notify())
        expect(latest).toEqual({variant: "task-first", enrolled: true})
        expect(analytics.capture).toHaveBeenCalledOnce()
    })

    it("falls back at once when flags load without a variant for this visitor", () => {
        const client = fakePostHog()
        mount()
        setClient(client)
        act(() => client.notify())
        expect(latest).toEqual({variant: "control", enrolled: false})
        expect(analytics.capture).not.toHaveBeenCalled()
        expect(client.unsubscribe).toHaveBeenCalled()
    })

    it("stops reading the flag once the timeout has decided, and never enrolls late", () => {
        vi.useFakeTimers()
        const client = fakePostHog()
        mount()
        setClient(client)
        act(() => vi.advanceTimersByTime(ONBOARDING_FLAG_TIMEOUT_MS))
        expect(latest).toEqual({variant: "control", enrolled: false})
        expect(client.unsubscribe).toHaveBeenCalled()
        const reads = client.getFeatureFlag.mock.calls.length
        client.getFeatureFlag.mockReturnValue("task-first")
        act(() => client.notify())
        expect(client.getFeatureFlag).toHaveBeenCalledTimes(reads)
        expect(latest).toEqual({variant: "control", enrolled: false})
        expect(analytics.capture).not.toHaveBeenCalled()
    })

    it("does not read the flag at all when a client arrives after the timeout", () => {
        vi.useFakeTimers()
        const client = fakePostHog("task-first")
        mount()
        act(() => vi.advanceTimersByTime(ONBOARDING_FLAG_TIMEOUT_MS))
        setClient(client)
        expect(client.getFeatureFlag).not.toHaveBeenCalled()
        expect(latest).toEqual({variant: "control", enrolled: false})
    })
})
