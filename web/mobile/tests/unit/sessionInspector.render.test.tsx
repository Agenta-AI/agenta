// @vitest-environment jsdom
import {activeUserIdAtom, playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {flushSync} from "react-dom"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {InspectSessionButton} from "@/features/chat/SessionInspectorSheet"

vi.mock("@agenta/entities/session", async () => {
    const {atom} = await import("jotai")
    const recordsAtom = atom({data: [], isLoading: false, isError: false})
    return {
        sessionRecordsQueryFamily: () => recordsAtom,
        revalidateSessionRecordsAtom: atom(null, () => undefined),
    }
})

vi.mock("@agenta/ui/ui", () => ({
    Button: ({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>{children}</button>
    ),
    SimpleTooltip: ({children}: {children: React.ReactNode}) => children,
}))

vi.mock("@phosphor-icons/react", () => ({
    ArrowClockwise: () => null,
    DownloadSimple: () => null,
    MagnifyingGlass: () => null,
}))

vi.mock("@/components/ui/sheet", () => ({
    Sheet: ({open, children}: {open: boolean; children: React.ReactNode}) =>
        open ? <div>{children}</div> : null,
    SheetContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
    SheetDescription: ({children}: {children: React.ReactNode}) => <p>{children}</p>,
    SheetHeader: ({children}: {children: React.ReactNode}) => <header>{children}</header>,
    SheetTitle: ({children}: {children: React.ReactNode}) => <h2>{children}</h2>,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
    if (root) flushSync(() => root!.unmount())
    root = undefined
    host?.remove()
    host = undefined
    localStorage.clear()
})

const renderButton = (enabled: boolean) => {
    const store = createStore()
    store.set(activeUserIdAtom, "qa-user")
    store.set(playgroundInspectorEnabledAtom, enabled)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    flushSync(() => {
        root!.render(
            <Provider store={store}>
                <InspectSessionButton sessionId="session-123" />
            </Provider>,
        )
    })
    return host
}

describe("mobile session inspector control", () => {
    it("stays hidden while the debug preference is off", () => {
        expect(renderButton(false).querySelector('[aria-label="Inspect session"]')).toBeNull()
    })

    it("opens the current session inspector while the debug preference is on", () => {
        const view = renderButton(true)
        const trigger = view.querySelector<HTMLButtonElement>('[aria-label="Inspect session"]')
        expect(trigger).not.toBeNull()

        flushSync(() => trigger!.click())

        expect(view.textContent).toContain("Session inspector")
        expect(view.textContent).toContain("session-123")
    })
})
