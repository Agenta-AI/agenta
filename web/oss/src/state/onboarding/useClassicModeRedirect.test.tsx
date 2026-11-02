import {act} from "react"

import {useClassicModeRedirect} from "@agenta/shared/hooks"
import {ACTIVE_USER_ID_KEY, activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

/**
 * The post-sign-in hop to `/m`: sign-in ends with a client-side push off `/auth`, so the hook
 * has to re-check when the ROUTE changes, not only when the preference or the user does.
 */
describe("useClassicModeRedirect", () => {
    const userId = "user-1"
    const replace = vi.fn()
    let root: Root
    let container: HTMLDivElement
    const location = {pathname: "/auth", search: "", replace}
    // jsdom drops `localStorage` once `location` is replaced (storage is keyed by origin), so
    // the hook's storage reads go through a plain map instead — same stand-in the shared suite
    // uses for these atoms.
    const entries: Record<string, string> = {}
    const localStorage = {
        getItem: (key: string) => entries[key] ?? null,
        setItem: (key: string, value: string) => {
            entries[key] = value
        },
        removeItem: (key: string) => {
            delete entries[key]
        },
        clear: () => {
            for (const key of Object.keys(entries)) delete entries[key]
        },
    }

    const Probe = ({locationKey}: {locationKey: string}) => {
        useClassicModeRedirect(true, locationKey)
        return null
    }

    const render = (store: ReturnType<typeof createStore>, locationKey: string) =>
        act(() => {
            root.render(
                <Provider store={store}>
                    <Probe locationKey={locationKey} />
                </Provider>,
            )
        })

    beforeEach(() => {
        ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
        replace.mockClear()
        location.pathname = "/auth"
        Object.defineProperty(window, "location", {value: location, writable: true})
        Object.defineProperty(window, "localStorage", {value: localStorage, writable: true})
        localStorage.clear()
        // Classic mode OFF, as an explicit choice — the settled value never changes after this.
        localStorage.setItem(ACTIVE_USER_ID_KEY, userId)
        localStorage.setItem(`agenta:onboarding:${userId}:nav-simplified-override`, "true")
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("hops to /m once sign-in has pushed off /auth", async () => {
        const store = createStore()
        store.set(activeUserIdAtom, userId)

        await render(store, "/auth")
        expect(replace).not.toHaveBeenCalled()

        // The client-side push: the preference, user and `enabled` are all unchanged.
        location.pathname = "/w/ws-1/p/proj-1/apps"
        await render(store, "/w/ws-1/p/proj-1/apps")

        expect(replace).toHaveBeenCalledWith("/m/w/ws-1/p/proj-1/apps")
        expect(document.cookie).toContain("agenta-classic-mode=0")
    })

    it("stays put on a desktop-only page", async () => {
        const store = createStore()
        store.set(activeUserIdAtom, userId)

        location.pathname = "/post-signup"
        await render(store, "/post-signup")

        expect(replace).not.toHaveBeenCalled()
    })
})
