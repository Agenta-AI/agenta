// @vitest-environment jsdom
/** The auto-refresh timer the observability toolbar's switch drives. */
import {act} from "react"

import {autoRefreshAtom} from "@agenta/observability"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useAutoRefresh} from "../../src/toolbar/useAutoRefresh"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>
let manual: () => Promise<void>
const reload = vi.fn(async () => undefined)

const Probe = () => {
    manual = useAutoRefresh(reload).refresh
    return null
}

const advance = (ms: number) => act(async () => vi.advanceTimersByTime(ms))

beforeEach(async () => {
    vi.useFakeTimers()
    reload.mockReset()
    reload.mockImplementation(async () => undefined)
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () =>
        root.render(
            <Provider store={store}>
                <Probe />
            </Provider>,
        ),
    )
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
})

describe("auto-refresh", () => {
    it("Reloads every 15 seconds while it is on, and stops when it is off", async () => {
        await advance(15000)
        expect(reload).not.toHaveBeenCalled()

        act(() => store.set(autoRefreshAtom, true))
        await advance(15000)
        expect(reload).toHaveBeenCalledTimes(1)
        await advance(15000)
        expect(reload).toHaveBeenCalledTimes(2)

        act(() => store.set(autoRefreshAtom, false))
        await advance(30000)
        expect(reload).toHaveBeenCalledTimes(2)
    })

    it("Skips a refresh while the previous one is still running", async () => {
        let finish = () => undefined as void
        reload.mockImplementationOnce(
            () => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))),
        )
        act(() => store.set(autoRefreshAtom, true))
        await advance(15000)
        expect(reload).toHaveBeenCalledTimes(1)
        // A manual refresh and later ticks wait for the slow reload.
        await act(async () => void manual())
        await advance(30000)
        expect(reload).toHaveBeenCalledTimes(1)

        await act(async () => finish())
        await advance(15000)
        expect(reload).toHaveBeenCalledTimes(2)
    })

    it("A manual refresh restarts the 15 second countdown", async () => {
        act(() => store.set(autoRefreshAtom, true))
        await advance(10000)
        await act(async () => manual())
        expect(reload).toHaveBeenCalledTimes(1)
        await advance(10000)
        expect(reload).toHaveBeenCalledTimes(1)
        await advance(5000)
        expect(reload).toHaveBeenCalledTimes(2)
    })
})
