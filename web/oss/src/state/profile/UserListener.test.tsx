import {act} from "react"

import {activeUserIdAtom, userAtom as sharedUserAtom} from "@agenta/shared/state"
import {atom, createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mock = vi.hoisted(() => ({
    session: {loading: false, doesSessionExist: true, userId: "session-id"},
}))
vi.mock("supertokens-auth-react/recipe/session", () => ({useSessionContext: () => mock.session}))
vi.mock("./selectors/user", () => {
    const profileQueryAtom = atom({isPending: false, error: null as Error | null})
    const userAtom = atom({
        id: "db-id",
        uid: "profile-uid",
        username: "qa",
        email: "qa@example.com",
    })
    return {profileQueryAtom, userAtom}
})

import {profileQueryAtom, userAtom} from "./selectors/user"
import UserListener from "./UserListener"

const profileState = profileQueryAtom as unknown as PrimitiveAtom<{
    isPending: boolean
    error: Error | null
}>
const profileUser = userAtom as PrimitiveAtom<{
    id: string
    uid: string
    username: string
    email: string
}>

let root: Root
let container: HTMLDivElement
let store: ReturnType<typeof createStore>
const render = () =>
    act(() =>
        root.render(
            <Provider store={store}>
                <UserListener />
            </Provider>,
        ),
    )

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    localStorage.clear()
    mock.session = {loading: false, doesSessionExist: true, userId: "session-id"}
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    store = createStore()
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe("desktop preference identity", () => {
    it("uses profile.uid and preserves the existing mobile Developer Mode choice", async () => {
        store.set(activeUserIdAtom, "session-id")
        localStorage.setItem("agenta:onboarding:session-id:nav-simplified-override", "true")
        localStorage.setItem("agenta:onboarding:profile-uid:nav-simplified-override", "false")
        await render()
        expect(store.get(activeUserIdAtom)).toBe("profile-uid")
        expect(store.get(sharedUserAtom)?.uid).toBe("profile-uid")
        expect(localStorage.getItem("agenta:onboarding:profile-uid:nav-simplified-override")).toBe(
            "false",
        )
    })

    it("does not clear scope during a pending or failed profile read", async () => {
        store.set(activeUserIdAtom, "profile-uid")
        store.set(profileState, {isPending: true, error: null})
        await render()
        expect(store.get(activeUserIdAtom)).toBe("profile-uid")
        await act(() => store.set(profileState, {isPending: false, error: new Error("network")}))
        expect(store.get(activeUserIdAtom)).toBe("profile-uid")
    })

    it.each([
        {isPending: true, error: null},
        {isPending: false, error: new Error("network")},
    ])("clears identity on sign-out even when the profile is unavailable (%j)", async (profile) => {
        await render()
        expect(store.get(activeUserIdAtom)).toBe("profile-uid")
        expect(store.get(sharedUserAtom)?.uid).toBe("profile-uid")
        await act(() => store.set(profileState, profile))
        mock.session = {loading: false, doesSessionExist: false, userId: ""}
        await render()
        expect(store.get(activeUserIdAtom)).toBeNull()
        expect(store.get(sharedUserAtom)).toBeNull()
        expect(localStorage.getItem("agenta:onboarding:active-user-id")).toBeNull()
    })

    it("preserves identity while the session is loading", async () => {
        await render()
        mock.session = {loading: true, doesSessionExist: false, userId: ""}
        await render()
        expect(store.get(activeUserIdAtom)).toBe("profile-uid")
        expect(store.get(sharedUserAtom)?.uid).toBe("profile-uid")
    })

    it("clears the scope on sign-out and scopes the next account independently", async () => {
        await render()
        mock.session = {loading: false, doesSessionExist: false, userId: ""}
        await render()
        expect(store.get(activeUserIdAtom)).toBeNull()
        expect(store.get(sharedUserAtom)).toBeNull()
        mock.session = {loading: false, doesSessionExist: true, userId: "another-session"}
        await act(() =>
            store.set(profileUser, {
                id: "other-db",
                uid: "other-uid",
                username: "other",
                email: "other@example.com",
            }),
        )
        await render()
        expect(store.get(activeUserIdAtom)).toBe("other-uid")
    })
})
