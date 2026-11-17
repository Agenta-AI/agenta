import {act} from "react"

import {useClassicModeRedirect} from "@agenta/shared/hooks"
import {ACTIVE_USER_ID_KEY, activeUserIdAtom, userAtom} from "@agenta/shared/state"
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
        // The deployment offers beta developer mode (`AGENTA_BETA_DEVELOPER_MODE=true`).
        vi.stubGlobal("__env", {NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE: "true"})
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
        vi.unstubAllGlobals()
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
    describe("Developer Mode on", () => {
        const OLD_ACCOUNT = {
            id: userId,
            uid: userId,
            username: "u",
            email: "u@example.com",
            created_at: "2026-07-01 00:00:00.000000+00:00",
        }
        const cookieAtNavigation: (string | undefined)[] = []

        // A browser with no gate cookie yet (a new device, or cleared cookies), on a /w page.
        const openW = async (
            pathname: string,
            stored: {developerMode?: boolean; beta?: boolean},
        ) => {
            localStorage.clear()
            localStorage.setItem(ACTIVE_USER_ID_KEY, userId)
            if (stored.developerMode !== undefined) {
                localStorage.setItem(
                    `agenta:onboarding:${userId}:nav-simplified-override`,
                    String(!stored.developerMode),
                )
            }
            if (stored.beta !== undefined) {
                localStorage.setItem(
                    `agenta:settings:${userId}:beta-developer-mode`,
                    JSON.stringify(stored.beta),
                )
            }
            document.cookie = "agenta-classic-mode=; path=/; max-age=0"
            const store = createStore()
            store.set(activeUserIdAtom, userId)
            store.set(userAtom, OLD_ACCOUNT)
            location.pathname = pathname
            await render(store, pathname)
        }

        beforeEach(() => {
            cookieAtNavigation.length = 0
            replace.mockImplementation(() => {
                cookieAtNavigation.push(
                    document.cookie.match(/(?:^|; )agenta-classic-mode=([^;]*)/)?.[1],
                )
            })
        })

        afterEach(() => replace.mockReset())

        for (const [label, developerMode] of [
            ["by choice", true],
            ["by default", undefined],
        ] as const) {
            it(`${label}, beta on: writes 0, then goes to the same page in /m`, async () => {
                await openW("/w/ws-1/p/proj-1/apps", {developerMode, beta: true})

                expect(replace).toHaveBeenCalledWith("/m/w/ws-1/p/proj-1/apps")
                expect(cookieAtNavigation).toEqual(["0"])
            })

            it(`${label}, beta on: a /w developer page goes to the matching /m page`, async () => {
                await openW("/w/ws-1/p/proj-1/evaluations", {developerMode, beta: true})

                expect(replace).toHaveBeenCalledWith("/m/w/ws-1/p/proj-1/evaluations")
            })

            it(`${label}, beta on: stays on a /w page that /m lacks`, async () => {
                await openW("/w/ws-1/p/proj-1/evaluations/results/compare", {
                    developerMode,
                    beta: true,
                })

                expect(replace).not.toHaveBeenCalled()
            })

            it(`${label}, beta off: stays in /w, as before`, async () => {
                await openW("/w/ws-1/p/proj-1/apps", {developerMode, beta: false})

                expect(replace).not.toHaveBeenCalled()
            })
        }
    })
})
