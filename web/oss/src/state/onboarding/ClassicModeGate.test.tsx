import {act} from "react"

import {Provider, createStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({asPath: "/auth"}))

vi.mock("next/router", () => ({
    useRouter: () => router,
}))

const USER_ID = "user-hop-test"
const location = {pathname: "/auth", search: "", replace: vi.fn()}

let root: Root | null = null
let container: HTMLDivElement | null = null

const setRoute = (path: string) => {
    router.asPath = path
    location.pathname = path
}

const mount = async () => {
    const [{default: ClassicModeGate}, {authFlowAtom}] = await Promise.all([
        import("./ClassicModeGate"),
        import("@/oss/state/session"),
    ])
    const store = createStore()
    store.set(authFlowAtom, "authed")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const render = async () => {
        await act(async () => {
            root?.render(
                <Provider store={store}>
                    <ClassicModeGate />
                </Provider>,
            )
        })
    }
    await render()
    return render
}

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, "location", {value: location, writable: true, configurable: true})
    localStorage.clear()
    // A signed-in user who chose the simplified experience.
    localStorage.setItem("agenta:onboarding:active-user-id", USER_ID)
    localStorage.setItem(`agenta:onboarding:${USER_ID}:nav-simplified-override`, "true")
    location.replace.mockClear()
    setRoute("/auth")
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
    })
    root = null
    container?.remove()
    container = null
})

describe("ClassicModeGate", () => {
    // Sign-in and post-signup both exit with a client-side push; the middleware never sees it.
    it("hops to /m after a client-side navigation off /auth", async () => {
        const render = await mount()
        expect(location.replace).not.toHaveBeenCalled()

        setRoute("/w/ws1/p/pr1/apps")
        await render()

        expect(location.replace).toHaveBeenCalledWith("/m/w/ws1/p/pr1/apps")
        expect(document.cookie).toContain("agenta-classic-mode=0")
    })

    it("stays put when the destination is a page /m does not have", async () => {
        const render = await mount()

        setRoute("/w/ws1/p/pr1/evaluations")
        await render()

        expect(location.replace).not.toHaveBeenCalled()
    })
})
