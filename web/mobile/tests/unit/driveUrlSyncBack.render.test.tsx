/**
 * @vitest-environment jsdom
 *
 * A shared `?drive=` link on a phone. The link opens Files; Files is a level of the system back,
 * so the page gets a back entry on top of the link's entry. A back closes Files and lands on the
 * link's entry: that entry must not keep `?drive=`, or a reload opens Files again.
 */
import {useState} from "react"

import {act, cleanup, render} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entity-ui/drive", async () => {
    const {atom} = await import("jotai")
    const quickLook = atom<{path: string} | null>(null)
    return {
        driveQuickLookAtomFamily: () => quickLook,
        useCopyText: () => () => undefined,
    }
})

const {driveQuickLookAtomFamily} = await import("@agenta/entity-ui/drive")
// The source module: its test reset is not part of the package entry.
const {resetSystemBackForTests, useSystemBack} =
    await import("../../../packages/agenta-ui/src/view-stack/systemBack")
const {useDriveUrlSync} = await import("../../src/features/chat/useDriveUrlSync")

const PAGE = "/w/ws/p/pr/agents/a1/sessions/s1"

/** The Files pane as the agent layout runs it on a phone: open while a quick look is set. */
const FilesPane = ({store}: {store: ReturnType<typeof createStore>}) => {
    const [closed, setClosed] = useState(false)
    const open = !closed && store.get(driveQuickLookAtomFamily("s1")) !== null
    const link = useDriveUrlSync({sessionId: "s1", open, enabled: true})
    useSystemBack(open ? 1 : 0, "panel", () => setClosed(true))
    return open ? (
        <button onClick={() => link.onSelectionChange?.({path: "reports/q3.md", isFolder: false})}>
            select
        </button>
    ) : null
}

const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 20)))

beforeEach(() => {
    window.history.replaceState({key: "page"}, "", `${PAGE}?drive=reports/q3.md`)
})

afterEach(() => {
    cleanup()
    resetSystemBackForTests()
    window.history.replaceState(null, "", "/")
})

describe("useDriveUrlSync on a phone", () => {
    it("opens Files from the link, and a back leaves no link on the page entry", async () => {
        const store = createStore()
        const {getByText, rerender} = render(
            <Provider store={store}>
                <FilesPane store={store} />
            </Provider>,
        )
        // The link was read: the quick look holds it.
        expect(store.get(driveQuickLookAtomFamily("s1"))).toMatchObject({path: "reports/q3.md"})
        rerender(
            <Provider store={store}>
                <FilesPane store={store} />
            </Provider>,
        )
        await settle()
        // The pane writes the selection on its own entry, the back entry on top.
        act(() => getByText("select").click())
        expect(window.location.search).toBe("?drive=reports/q3.md")

        act(() => window.history.back())
        await settle()
        await settle()

        expect(window.location.pathname).toBe(PAGE)
        expect(window.location.search).toBe("")
    })
})
