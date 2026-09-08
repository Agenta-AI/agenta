/**
 * `useMountGeneration` is the guard behind the unmount-mid-stream blocker on PR #6658.
 *
 * The two properties it exists for are both tested here, because both were live defects in the
 * boolean version it replaces:
 *
 * 1. A generation captured before an unmount is never current again, even though the session
 *    registry hands the SAME `Chat` to the next mount.
 * 2. It does not fail open across a React StrictMode replay. A boolean re-armed by the second
 *    setup let work captured before the cleanup complete as though the cleanup never happened.
 */
import {createElement, StrictMode, useEffect} from "react"

import {act} from "@testing-library/react"
import {createRoot} from "react-dom/client"
import {describe, expect, it} from "vitest"

import {useMountGeneration, type MountGeneration} from "../../../src/hooks/useMountGeneration"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

/** Renders the hook and records what each effect SETUP captured, in order. */
const renderProbe = (strict: boolean) => {
    const capturedInSetup: number[] = []
    let api: MountGeneration | undefined
    const Probe = () => {
        const mount = useMountGeneration()
        api = mount
        useEffect(() => {
            capturedInSetup.push(mount.capture())
        }, [mount])
        return null
    }
    const root = createRoot(document.createElement("div"))
    const tree = createElement(Probe)
    act(() => root.render(strict ? createElement(StrictMode, null, tree) : tree))
    return {capturedInSetup, api: () => api!, unmount: () => act(() => root.unmount())}
}

describe("useMountGeneration", () => {
    it("treats the generation it handed out as current while the mount is live", () => {
        const probe = renderProbe(false)
        const generation = probe.api().capture()

        expect(generation).toBeGreaterThan(0)
        expect(probe.api().isCurrent(generation)).toBe(true)
        probe.unmount()
    })

    it("never reports a generation captured before an unmount as current again", () => {
        const first = renderProbe(false)
        const stale = first.api().capture()
        const staleApi = first.api()
        first.unmount()

        // The old mount's own API is what an in-flight chain still holds.
        expect(staleApi.isCurrent(stale)).toBe(false)

        // A fresh mount does not resurrect it either, which is the case the session registry
        // creates by preserving the same chat instance across the remount.
        const second = renderProbe(false)
        expect(second.api().isCurrent(stale)).toBe(false)
        expect(second.api().isCurrent(second.api().capture())).toBe(true)
        second.unmount()
    })

    it("gives each StrictMode effect generation its own identity", () => {
        const probe = renderProbe(true)

        // StrictMode runs setup, cleanup, setup on ONE component instance.
        expect(probe.capturedInSetup).toHaveLength(2)
        const [beforeReplay, afterReplay] = probe.capturedInSetup
        expect(beforeReplay).not.toBe(afterReplay)

        // The whole point: work captured by the first setup cannot write after the replay, while
        // the second setup's own generation still can.
        expect(probe.api().isCurrent(beforeReplay)).toBe(false)
        expect(probe.api().isCurrent(afterReplay)).toBe(true)
        probe.unmount()
    })

    it("blocks an effect declared ABOVE it once StrictMode replays", () => {
        // The ordering contract, pinned rather than assumed. Effects run in hook order, so an
        // effect declared above this hook captures BEFORE the replay re-arms it, and its capture
        // is dead. That is why every caller declares `useMountGeneration()` first. A caller that
        // does not gets a chain that can never write, which is safe but silently useless.
        const capturedInSetup: number[] = []
        let api: MountGeneration | undefined
        const Probe = () => {
            // Deliberately above the hook.
            useEffect(() => {
                capturedInSetup.push(api?.capture() ?? -1)
            }, [])
            const mount = useMountGeneration()
            api = mount
            return null
        }
        const root = createRoot(document.createElement("div"))
        act(() => root.render(createElement(StrictMode, null, createElement(Probe))))

        expect(capturedInSetup).toHaveLength(2)
        expect(api!.isCurrent(capturedInSetup[1])).toBe(false)
        act(() => root.unmount())
    })

    it("is current for a generation captured before the first effect runs", () => {
        // Hook order decides which effect runs first, so a chain started by an effect declared
        // ABOVE this hook must still be able to write. The first generation is allocated during
        // render for exactly that reason.
        let capturedInRender = 0
        let api: MountGeneration | undefined
        const Probe = () => {
            const mount = useMountGeneration()
            api = mount
            if (!capturedInRender) capturedInRender = mount.capture()
            return null
        }
        const root = createRoot(document.createElement("div"))
        act(() => root.render(createElement(Probe)))

        expect(capturedInRender).toBeGreaterThan(0)
        expect(api!.isCurrent(capturedInRender)).toBe(true)
        act(() => root.unmount())
    })
})
