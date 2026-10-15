// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({push: vi.fn()}))
vi.mock("next/router", () => ({useRouter: () => router}))

const invalidate = vi.hoisted(() => vi.fn())
vi.mock("@agenta/entities/workflow", () => ({invalidateWorkflowsListCache: invalidate}))

const dialog = vi.hoisted(() => ({props: null as Record<string, unknown> | null}))
vi.mock("@agenta/home-ui", () => ({
    ImportTemplateDialog: (props: Record<string, unknown>) => {
        dialog.props = props
        return null
    },
}))

import {ImportTemplateHost} from "@/features/agents/ImportTemplateHost"
import {
    importTemplateRequestAtom,
    openImportTemplateAtom,
} from "@/features/agents/importTemplateRequest"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
    dialog.props = null
    router.push.mockReset()
    invalidate.mockReset()
})

const mount = () => {
    const store = createStore()
    root = createRoot(document.createElement("div"))
    act(() =>
        root!.render(
            <Provider store={store}>
                <ImportTemplateHost base="/w/ws/p/pr" />
            </Provider>,
        ),
    )
    return store
}

describe("ImportTemplateHost", () => {
    it("mounts no dialog until an entry asks for one", () => {
        mount()
        expect(dialog.props).toBeNull()
    })

    it("opens the dialog on the source the entry named", () => {
        const store = mount()
        const start = {kind: "session_file", sessionId: "s-1", path: "templates/seo-1.0.0.zip"}
        act(() => store.set(openImportTemplateAtom, start as never))

        expect(dialog.props?.open).toBe(true)
        expect(dialog.props?.start).toEqual(start)
    })

    it("closes before it opens the new agent's first session", async () => {
        const store = mount()
        act(() =>
            store.set(openImportTemplateAtom, {
                kind: "upload",
                file: new File([], "seo-1.0.0.zip"),
            }),
        )
        let openAtPush: boolean | undefined
        router.push.mockImplementation(async () => {
            openAtPush = store.get(importTemplateRequestAtom)?.open
            return true
        })

        await act(async () => {
            ;(dialog.props?.onCreated as (agent: object) => void)({
                appId: "agent-1",
                revisionId: "rev-1",
                name: "SEO writer",
                sessionId: "session-1",
            })
        })

        expect(openAtPush).toBe(false)
        expect(router.push).toHaveBeenCalledWith("/w/ws/p/pr/sessions/session-1?agent=agent-1")
        expect(invalidate).toHaveBeenCalledTimes(1)
    })
})
