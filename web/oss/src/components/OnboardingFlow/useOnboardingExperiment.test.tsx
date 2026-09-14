import {act, cleanup, renderHook} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

const analytics = vi.hoisted(() => ({
    client: null as null | {
        getFeatureFlag: ReturnType<typeof vi.fn>
        onFeatureFlags: ReturnType<typeof vi.fn>
        capture: ReturnType<typeof vi.fn>
    },
}))
vi.mock("@/oss/lib/helpers/analytics/hooks/usePostHogAg", () => ({
    usePostHogAg: () => analytics.client,
}))
import {useOnboardingExperiment} from "./useOnboardingExperiment"

afterEach(() => {
    cleanup()
    vi.useRealTimers()
    analytics.client = null
})
describe("onboarding experiment", () => {
    it.each(["control", "task-first"])("uses the PostHog %s assignment", (variant) => {
        analytics.client = {
            getFeatureFlag: vi.fn(() => variant),
            onFeatureFlags: vi.fn(),
            capture: vi.fn(),
        }
        const {result} = renderHook(useOnboardingExperiment)
        expect(result.current.variant).toBe(variant)
        expect(result.current.enrolled).toBe(true)
        expect(analytics.client.capture).toHaveBeenCalledOnce()
    })
    it("does not block onboarding when analytics is unavailable", () => {
        vi.useFakeTimers()
        const {result} = renderHook(useOnboardingExperiment)
        act(() => {
            vi.advanceTimersByTime(3000)
        })
        expect(result.current.variant).toBe("control")
        expect(result.current.enrolled).toBe(false)
    })
    it("waits for flags and then freezes the assignment", () => {
        let notify = () => undefined
        const getFeatureFlag = vi.fn<() => string | undefined>(() => undefined)
        analytics.client = {
            getFeatureFlag,
            onFeatureFlags: vi.fn((callback) => {
                notify = callback
                return () => undefined
            }),
            capture: vi.fn(),
        }
        const {result} = renderHook(useOnboardingExperiment)
        expect(result.current.variant).toBeNull()
        getFeatureFlag.mockReturnValue("task-first")
        act(() => notify())
        getFeatureFlag.mockReturnValue("control")
        act(() => notify())
        expect(result.current.variant).toBe("task-first")
        expect(analytics.client.capture).toHaveBeenCalledOnce()
    })
    it("does not switch or enroll a fallback user after a late flag response", () => {
        vi.useFakeTimers()
        let notify = () => undefined
        const getFeatureFlag = vi.fn<() => string | undefined>(() => undefined)
        analytics.client = {
            getFeatureFlag,
            onFeatureFlags: vi.fn((callback) => {
                notify = callback
                return () => undefined
            }),
            capture: vi.fn(),
        }
        const {result} = renderHook(useOnboardingExperiment)
        act(() => vi.advanceTimersByTime(3000))
        getFeatureFlag.mockReturnValue("task-first")
        act(() => notify())
        expect(result.current.variant).toBe("control")
        expect(result.current.enrolled).toBe(false)
        expect(analytics.client.capture).not.toHaveBeenCalled()
    })
})
