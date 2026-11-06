// @vitest-environment jsdom
import {act} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {betaAtom, permission} = vi.hoisted(() => ({
    betaAtom: {current: null as PrimitiveAtom<boolean> | null},
    permission: vi.fn<(projectId: string, action: string) => boolean>(),
}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom: makeAtom} = await import("jotai")
    betaAtom.current = makeAtom(false)
    return {...original, betaDeveloperModeActiveAtom: betaAtom.current}
})

vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: permission,
}))

import {useMobileBottomNavItems} from "@/features/nav/useMobileNavItems"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const P = "/w/ws-1/p/proj-1"

describe("Invite Teammate in the rail", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    let items: SidebarConfig[] = []

    const Probe = ({includeSettingsLink}: {includeSettingsLink?: boolean}) => {
        items = useMobileBottomNavItems(P, {includeSettingsLink})
        return null
    }

    const render = (beta: boolean, includeSettingsLink = true) => {
        store.set(betaAtom.current!, beta)
        act(() =>
            root.render(
                <Provider store={store}>
                    <Probe includeSettingsLink={includeSettingsLink} />
                </Provider>,
            ),
        )
        return items.map(({key, link}) => ({key, link}))
    }

    beforeEach(() => {
        host = document.createElement("div")
        root = createRoot(host)
        store = createStore()
        permission.mockReset()
        permission.mockImplementation((projectId) => projectId === "proj-1")
    })

    afterEach(() => act(() => root.unmount()))

    it("beta developer mode adds Invite Teammate after Settings, opening the invite dialog", () => {
        expect(render(true)).toEqual([
            {key: "mobile-templates", link: `${P}/templates`},
            {key: "mobile-settings", link: `${P}/settings`},
            {
                key: "invite-teammate-link",
                link: `${P}/settings?tab=workspace&inviteModal=open`,
            },
        ])
        expect(permission).toHaveBeenCalledWith("proj-1", "add_new_user_to_workspace")
    })

    it("beta developer mode keeps Invite Teammate in the settings rail", () => {
        expect(render(true, false).map(({key}) => key)).toEqual(["invite-teammate-link"])
    })

    it("a reader who may not invite gets no row", () => {
        permission.mockReturnValue(false)
        expect(render(true).map(({key}) => key)).toEqual(["mobile-templates", "mobile-settings"])
    })

    it("without beta developer mode the bottom rail is unchanged and asks no permission", () => {
        expect(render(false).map(({key}) => key)).toEqual(["mobile-templates", "mobile-settings"])
        expect(render(false, false)).toEqual([])
        expect(permission.mock.calls.every(([projectId]) => projectId === "")).toBe(true)
    })
})
