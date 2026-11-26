// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const sdk = vi.hoisted(() => ({checkPermissions: vi.fn()}))
vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<object>()),
    getAccessClient: () => ({checkPermissions: sdk.checkPermissions}),
}))

import {useProjectPermissionState} from "@/features/context/useProjectPermission"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

type PermissionState = ReturnType<typeof useProjectPermissionState>

let host: HTMLDivElement
let root: Root
let latest: PermissionState

const Probe = () => {
    latest = useProjectPermissionState("pr", "view_evaluators")
    return null
}

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const mount = async () => {
    const client = new QueryClient()
    const wrapper = (children: ReactNode) => createElement(QueryClientProvider, {client}, children)
    await act(async () => {
        root.render(wrapper(createElement(Probe)))
    })
    await flush()
}

beforeEach(() => {
    sdk.checkPermissions.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("useProjectPermissionState", () => {
    it("allows when the backend allows", async () => {
        sdk.checkPermissions.mockResolvedValue({})
        await mount()
        expect(latest).toMatchObject({allowed: true, pending: false, failed: false})
    })

    it("reads a refusal as a denial", async () => {
        sdk.checkPermissions.mockRejectedValue({statusCode: 403})
        await mount()
        expect(latest).toMatchObject({allowed: false, pending: false, failed: false})
    })

    it("does not cache a failed lookup as a denial, and recheck runs it again", async () => {
        sdk.checkPermissions.mockRejectedValueOnce(new Error("network down"))
        await mount()
        expect(latest).toMatchObject({allowed: false, pending: false, failed: true})

        sdk.checkPermissions.mockResolvedValue({})
        await act(async () => {
            latest.recheck()
        })
        await flush()
        expect(sdk.checkPermissions).toHaveBeenCalledTimes(2)
        expect(latest).toMatchObject({allowed: true, pending: false, failed: false})
    })
})
