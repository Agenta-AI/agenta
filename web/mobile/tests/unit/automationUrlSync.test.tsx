// @vitest-environment jsdom
//
// The session page does not remount on a session switch, so a linked `?automation=` drawer on the
// next session must still open: the hook reads the link once per session, not once per mount.
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const {setSchedule, readQueryParam, replaceQueryParam, drawer} = vi.hoisted(() => ({
    setSchedule: vi.fn(),
    readQueryParam: vi.fn(),
    replaceQueryParam: vi.fn(),
    drawer: {schedule: null as {scheduleId: string} | null},
}))

vi.mock("@agenta/entities/gatewayTrigger", () => ({
    triggerScheduleDrawerAtom: {},
    triggerSubscriptionDrawerAtom: {},
}))
vi.mock("@agenta/shared/utils", () => ({
    AUTOMATION_QUERY_PARAM: "automation",
    readQueryParam,
    replaceQueryParam,
}))
vi.mock("jotai", () => ({
    useAtom: () => [drawer.schedule, setSchedule],
    useAtomValue: () => null,
}))

import {useAutomationUrlSync} from "@/features/automations/useAutomationUrlSync"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

const Probe = ({scope, ready}: {scope: string; ready: boolean}) => {
    useAutomationUrlSync({scope, ready})
    return null
}

const renderScope = (scope: string, ready = true) =>
    act(() => {
        root ??= createRoot(document.createElement("div"))
        root.render(createElement(Probe, {scope, ready}))
    })

afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    drawer.schedule = null
    vi.clearAllMocks()
})

describe("useAutomationUrlSync", () => {
    it("reads the link again when the session changes without a remount", () => {
        readQueryParam.mockReturnValue("auto-a")
        renderScope("session-a")
        expect(setSchedule).toHaveBeenCalledWith({
            scheduleId: "auto-a",
            playgroundEntityId: undefined,
        })

        readQueryParam.mockReturnValue("auto-b")
        renderScope("session-b")
        expect(setSchedule).toHaveBeenLastCalledWith({
            scheduleId: "auto-b",
            playgroundEntityId: undefined,
        })
        expect(setSchedule).toHaveBeenCalledTimes(2)
    })

    it("reads only once for the same session", () => {
        readQueryParam.mockReturnValue("auto-a")
        renderScope("session-a")
        renderScope("session-a")
        expect(setSchedule).toHaveBeenCalledTimes(1)
    })

    it("leaves the next session's link alone while its agent resolves", () => {
        drawer.schedule = {scheduleId: "auto-a"}
        renderScope("session-a")
        expect(replaceQueryParam).toHaveBeenLastCalledWith("automation", "auto-a")
        replaceQueryParam.mockClear()

        // Session B's agent is still resolving when A's drawer closes.
        drawer.schedule = null
        renderScope("session-b", false)
        expect(replaceQueryParam).not.toHaveBeenCalled()
    })

    it("does not write a drawer left open from the last session into the next one", () => {
        drawer.schedule = {scheduleId: "auto-a"}
        renderScope("session-a")
        replaceQueryParam.mockClear()
        renderScope("session-b", false)
        renderScope("session-b", true)
        expect(replaceQueryParam).not.toHaveBeenCalled()
    })
})
