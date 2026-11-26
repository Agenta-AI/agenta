// @vitest-environment jsdom
//
/**
 * The /m host of the revision drawer keeps its open state in the URL (`?revisionId=`), so a
 * pasted link opens it and closing it leaves a clean URL. The package drawer is a stub here: what
 * is under test is the URL, not the drawer.
 */
import {act} from "react"

import type {RevisionDrawerProps} from "@agenta/entity-ui/variant"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {router, drawerProps} = vi.hoisted(() => ({
    router: {
        pathname: "/w/[workspace_id]/p/[project_id]/apps/[app_id]/variants",
        query: {} as Record<string, string>,
        replace: vi.fn(),
    },
    drawerProps: {current: null as RevisionDrawerProps | null},
}))

vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@agenta/entity-ui/variant", () => ({
    RevisionDrawer: (props: RevisionDrawerProps) => {
        drawerProps.current = props
        return null
    },
}))

import {RevisionDrawerHost} from "@/features/revisions/RevisionDrawerHost"

let host: HTMLDivElement
let root: Root

const render = async () => {
    await act(async () => {
        root.render(<RevisionDrawerHost kind="variant" navigationIds={["rev-1", "rev-2"]} />)
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    router.query = {workspace_id: "ws-1", project_id: "proj-1", app_id: "app-1"}
    router.replace.mockReset()
    drawerProps.current = null
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("RevisionDrawerHost", () => {
    it("A revisionId in the URL opens the drawer", async () => {
        await render()
        expect(drawerProps.current?.revisionId).toBeNull()
        router.query = {...router.query, revisionId: "rev-1"}
        await render()
        expect(drawerProps.current?.revisionId).toBe("rev-1")
        expect(drawerProps.current?.kind).toBe("variant")
    })

    it("Closing the drawer removes revisionId from the URL", async () => {
        router.query = {...router.query, revisionId: "rev-1"}
        await render()
        await act(async () => drawerProps.current?.onClose())
        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: router.pathname,
                query: {workspace_id: "ws-1", project_id: "proj-1", app_id: "app-1"},
            },
            undefined,
            {shallow: true},
        )
    })

    it("Next writes the next revision id to the URL with a shallow replace", async () => {
        router.query = {...router.query, revisionId: "rev-1"}
        await render()
        await act(async () => drawerProps.current?.onNavigate?.("rev-2"))
        expect(router.replace).toHaveBeenCalledWith(
            {pathname: router.pathname, query: {...router.query, revisionId: "rev-2"}},
            undefined,
            {shallow: true},
        )
    })
})
