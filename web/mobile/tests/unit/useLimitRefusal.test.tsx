// @vitest-environment jsdom
/**
 * A limit refusal after submit stays until a usage read made after it shows room again, so a
 * key activated in another tab, or a usage read that had failed, does not leave Create off.
 */
import {act, renderHook} from "@testing-library/react"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({cloud: false}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isBillingEnabled: () => fixture.cloud,
}))

import type {LimitRefusal} from "@/features/limits/limitRefusal"
import {useLimitRefusal} from "@/features/limits/useLimitRefusal"
import type {InstanceLimitUsage} from "@/features/settings/licenseApi"

const REFUSAL: LimitRefusal = {code: "project_limit_reached", limit: 1}

interface Props {
    isSuccess: boolean
    dataUpdatedAt: number
    current: InstanceLimitUsage | null
}

const setup = (initial: Props) => {
    const refetch = vi.fn()
    const hook = renderHook(
        ({isSuccess, dataUpdatedAt, current}: Props) =>
            useLimitRefusal({isSuccess, dataUpdatedAt, refetch}, current),
        {initialProps: initial},
    )
    return {...hook, refetch}
}

describe("useLimitRefusal", () => {
    beforeEach(() => {
        fixture.cloud = false
    })

    it("reads the usage again, and lifts the refusal once a newer read shows room", () => {
        // The usage read had failed when the dialog opened.
        const {result, rerender, refetch} = setup({
            isSuccess: false,
            dataUpdatedAt: 0,
            current: null,
        })
        act(() => result.current.refuse(REFUSAL))
        expect(result.current.refusal).toEqual(REFUSAL)
        expect(refetch).toHaveBeenCalledOnce()

        // The key was activated in another tab: the next read has no limit.
        rerender({isSuccess: true, dataUpdatedAt: Date.now() + 1, current: {count: 1, limit: null}})
        expect(result.current.refusal).toBeNull()

        // A later usage read fails: the lifted refusal does not come back.
        rerender({
            isSuccess: false,
            dataUpdatedAt: Date.now() + 1,
            current: {count: 1, limit: null},
        })
        expect(result.current.refusal).toBeNull()
    })

    it("keeps the refusal while the newer read still shows the limit, or only older data", () => {
        const {result, rerender} = setup({
            isSuccess: true,
            dataUpdatedAt: 1,
            current: {count: 0, limit: 1},
        })
        act(() => result.current.refuse(REFUSAL))
        // Data read before the refusal does not lift it.
        expect(result.current.refusal).toEqual(REFUSAL)

        rerender({isSuccess: true, dataUpdatedAt: Date.now() + 1, current: {count: 1, limit: 1}})
        expect(result.current.refusal).toEqual(REFUSAL)
    })

    it("keeps the cloud refusal and reads no usage there", () => {
        fixture.cloud = true
        const {result, refetch} = setup({isSuccess: false, dataUpdatedAt: 0, current: null})
        act(() => result.current.refuse(REFUSAL))

        expect(result.current.refusal).toEqual(REFUSAL)
        expect(refetch).not.toHaveBeenCalled()
        act(() => result.current.clear())
        expect(result.current.refusal).toBeNull()
    })
})
