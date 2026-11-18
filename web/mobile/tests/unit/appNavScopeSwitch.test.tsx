// @vitest-environment jsdom
import {act} from "react"

import type {SidebarScope, SidebarSection} from "@agenta/navigation"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import {createMobileAppNavScope} from "@/features/nav/appNavScope"

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    const detail = atom({data: null})
    const latest = atom<string | null>(null)
    return {
        ...original,
        workflowDetailQueryAtomFamily: () => detail,
        workflowLatestRevisionIdAtomFamily: () => latest,
    }
})
vi.mock("@/features/developer/developerViewAccess", () => ({
    useEnabledDeveloperViews: () => DEVELOPER_VIEWS,
}))
const BOTTOM: never[] = []
vi.mock("@/features/nav/useMobileNavItems", () => ({useMobileBottomNavItems: () => BOTTOM}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("the app menu after an app switch", () => {
    let root: Root
    let sections: SidebarSection[] = []
    const Probe = ({scope}: {scope: SidebarScope}) => {
        sections = scope.useSections()
        return null
    }

    beforeEach(() => {
        root = createRoot(document.createElement("div"))
    })
    afterEach(() => act(() => root.unmount()))

    it("links Playground to the new app, not the previous one", async () => {
        const store = createStore()
        const draw = (appId: string) =>
            act(async () =>
                root.render(
                    <Provider store={store}>
                        <Probe scope={createMobileAppNavScope("ws-1", "proj-1", appId)} />
                    </Provider>,
                ),
            )
        await draw("a1")
        await draw("a2")
        const playground = sections[0].items.find((item) => item.title === "Playground")
        expect(playground?.link).toBe("/w/ws-1/p/proj-1/apps/a2/playground")
    })
})
