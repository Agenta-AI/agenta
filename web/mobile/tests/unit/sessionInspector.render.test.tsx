// @vitest-environment jsdom
/** "Inspect session" lives in the session bar's ⋯: a menu on a desktop, a sheet on a phone. */
import {act} from "react"

import {activeUserIdAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {SessionMoreMenu} from "@/features/chat/SessionMoreMenu"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    const recordsAtom = atom({data: [], isLoading: false, isError: false})
    return {
        ...(await importOriginal<typeof import("@agenta/entities/session")>()),
        sessionRecordsQueryFamily: () => recordsAtom,
        revalidateSessionRecordsAtom: atom(null, () => undefined),
    }
})

vi.mock("@agenta/entities/browser", async (importOriginal) => {
    const {atom} = await import("jotai")
    const status = atom({data: undefined})
    return {
        ...(await importOriginal<typeof import("@agenta/entities/browser")>()),
        browserLiveStatusQueryAtomFamily: () => status,
    }
})

vi.mock("@agenta/entity-ui/drive", () => ({
    useSessionFilesPane: () => ({toggle: () => undefined}),
}))

vi.mock("@/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({data: null}),
}))

// Node's own `localStorage` global shadows jsdom's and has no storage file here.
const storage = new Map<string, string>()
vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
})

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host?.remove()
    host = undefined
    storage.clear()
})

const renderMenu = ({enabled, phone}: {enabled: boolean; phone: boolean}) => {
    const store = createStore()
    store.set(activeUserIdAtom, "qa-user")
    store.set(playgroundInspectorEnabledAtom, enabled)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root!.render(
            <Provider store={store}>
                <SessionMoreMenu
                    sessionId="session-123"
                    entityId={null}
                    agentName="Support triage"
                    agentHidden
                    hasSessions
                    projectId="project-1"
                    phone={phone}
                    onOpenShortcuts={() => undefined}
                />
            </Provider>,
        )
    })
}

/** The desktop menu opens on pointerdown, the phone sheet on click. */
const openMenu = async () => {
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!
    await act(async () => {
        trigger.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
        trigger.click()
    })
}

const action = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find((element) =>
        element.textContent?.includes(label),
    )

describe.each([
    ["desktop menu", false, "Keyboard shortcuts"],
    ["phone sheet", true, "Files"],
] as const)("mobile session inspector in the %s", (_surface, phone, otherAction) => {
    it("stays out while the debug preference is off", async () => {
        renderMenu({enabled: false, phone})
        await openMenu()

        expect(action(otherAction)).toBeDefined()
        expect(action("Inspect session")).toBeUndefined()
    })

    it("opens the current session inspector while the debug preference is on", async () => {
        renderMenu({enabled: true, phone})
        await openMenu()
        await act(async () => action("Inspect session")!.click())

        expect(document.body.textContent).toContain("Session inspector")
        expect(document.body.textContent).toContain("session-123")
    })
})
