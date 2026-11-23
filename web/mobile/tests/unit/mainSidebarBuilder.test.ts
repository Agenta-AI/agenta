/**
 * The builder in the main sidebar: its chats sit under their own heading and open on the builder
 * page, its heading's open button opens the builder sidebar there, and that button mirrors the
 * agent sidebar's fold button.
 */
import {isValidElement} from "react"

import {ArrowsOutLineVerticalIcon} from "@phosphor-icons/react"
import {getDefaultStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

const builderIdAtom = vi.hoisted(() => ({current: null as unknown}))
vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    builderIdAtom.current = atom<string | null>("builder-wf")
    return {...original, builderAgentWorkflowIdAtom: builderIdAtom.current}
})

const routerPush = vi.hoisted(() => vi.fn(async () => true))
vi.mock("next/router", () => ({
    default: {push: routerPush},
    useRouter: () => ({push: routerPush, query: {}, pathname: "/", asPath: "/", basePath: "/m"}),
}))

const {mobileSessionsEntity} = await import("@/features/nav/useMobileNavItems")
const {builderSidebarHiddenAtom} = await import("@/features/builder-page/builderSidebarState")
const {selectedSidebarAtom} = await import("@/features/agent-sidebar/selectedSidebar")

const P = "/w/ws-1/p/proj-1"
const builderGroup = {key: "agent:builder-wf", label: "Builder", agentId: "builder-wf"}
const agentGroup = {key: "agent:support", label: "Support triage", agentId: "support"}
const ref = (sessionId: string, agentId: string) =>
    ({id: sessionId, sessionId, agentId, appId: agentId}) as never

afterEach(() => {
    routerPush.mockClear()
    getDefaultStore().set(builderSidebarHiddenAtom, false)
})

describe("the builder in the main sidebar", () => {
    it("opens a builder chat on the builder page and another agent's session on its own page", () => {
        expect(mobileSessionsEntity.childLink(ref("s1", "builder-wf"), P)).toBe(`${P}/builder/s1`)
        expect(mobileSessionsEntity.childLink(ref("s2", "support"), P)).toBe(`${P}/sessions/s2`)
    })

    it("gives the builder heading a New chat link that brings the builder sidebar back", () => {
        const add = mobileSessionsEntity.groupAddLink?.(builderGroup, P)
        expect(add).toMatchObject({link: `${P}/builder`, label: "New chat"})
        getDefaultStore().set(builderSidebarHiddenAtom, true)
        add?.onClick?.({} as never)
        expect(getDefaultStore().get(builderSidebarHiddenAtom)).toBe(false)
    })

    it("opens the builder page with the builder sidebar from the builder heading", () => {
        getDefaultStore().set(builderSidebarHiddenAtom, true)
        const enter = mobileSessionsEntity.groupEnter?.(builderGroup, P)
        expect(enter?.label).toBe("Open Builder")
        enter?.onClick()
        expect(routerPush).toHaveBeenCalledWith(`${P}/builder`)
        expect(getDefaultStore().get(builderSidebarHiddenAtom)).toBe(false)
    })

    it("opens an agent's sidebar in place from its heading, with the same unfold glyph", () => {
        const enter = mobileSessionsEntity.groupEnter?.(agentGroup, P)
        enter?.onClick()
        expect(routerPush).not.toHaveBeenCalled()
        expect(getDefaultStore().get(selectedSidebarAtom)).toEqual({
            kind: "agent",
            agentId: "support",
            from: "main",
        })
        const builderIcon = mobileSessionsEntity.groupEnter?.(builderGroup, P)?.icon
        expect(isValidElement(enter?.icon) && isValidElement(builderIcon)).toBe(true)
        expect((enter?.icon as {type: unknown}).type).toBe(ArrowsOutLineVerticalIcon)
        expect((builderIcon as {type: unknown}).type).toBe(ArrowsOutLineVerticalIcon)
    })

    it("gives a heading with no agent no open button", () => {
        expect(
            mobileSessionsEntity.groupEnter?.({key: "pinned", label: "Pinned"}, P),
        ).toBeUndefined()
    })
})
