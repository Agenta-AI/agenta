// @vitest-environment jsdom
//
// The session page does not remount on a session switch, so a linked `?automation=` drawer on the
// next session must still open: the hook reads the link once per session, not once per mount.
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const {setSchedule, readQueryParam} = vi.hoisted(() => ({
    setSchedule: vi.fn(),
    readQueryParam: vi.fn(),
}))

vi.mock("@agenta/entities/gatewayTrigger", () => ({
    triggerScheduleDrawerAtom: {},
    triggerSubscriptionDrawerAtom: {},
}))
vi.mock("@agenta/shared/utils", () => ({
    AUTOMATION_QUERY_PARAM: "automation",
    readQueryParam,
    replaceQueryParam: vi.fn(),
}))
vi.mock("jotai", () => ({
    useAtom: () => [null, setSchedule],
    useAtomValue: () => null,
}))

import {useAutomationUrlSync} from "@/features/automations/useAutomationUrlSync"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

const Probe = ({scope}: {scope: string}) => {
    useAutomationUrlSync({scope})
    return null
}

const renderScope = (scope: string) =>
    act(() => {
        root ??= createRoot(document.createElement("div"))
        root.render(createElement(Probe, {scope}))
    })

afterEach(() => {
    act(() => root?.unmount())
    root = undefined
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
})
