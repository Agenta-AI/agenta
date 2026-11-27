// @vitest-environment jsdom
import {act} from "react"

import {useClassicModeCookieSync} from "@agenta/shared/hooks"
import {activeUserIdAtom, navSimplifiedOverrideAtom} from "@agenta/shared/state"
import {CLASSIC_MODE_COOKIE, decideMobileGate} from "@agenta/shared/utils/mobileGate"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {developerNavItems} from "@/features/developer/developerNavItems"
import {enabledDeveloperViewsAtom} from "@/features/developer/developerViewAccess"
import {PreferencesTab} from "@/features/settings/PreferencesTab"

import {TEST_DEVELOPER_VIEWS} from "./developerViewFixtures"

vi.mock("@/features/developer/developerViews", async () => ({
    DEVELOPER_VIEWS: (await import("./developerViewFixtures")).TEST_DEVELOPER_VIEWS,
}))

// The real cookie writer and cookie sync: this test checks what the gates will read.
vi.mock("@agenta/shared/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    desktopEscapeHref: () => "/w",
}))

vi.mock("@agenta/ui/theme", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useThemeMode: () => ({themeMode: "light", setMode: () => undefined}),
}))

// Radix's switch is not what this test checks: a plain button carries the same contract.
vi.mock("@agenta/ui/ui", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    Switch: ({
        checked,
        onCheckedChange,
        ...props
    }: {
        checked: boolean
        onCheckedChange: (next: boolean) => void
        "aria-label"?: string
    }) => (
        <button
            role="switch"
            aria-checked={checked}
            aria-label={props["aria-label"]}
            onClick={() => onCheckedChange(!checked)}
        />
    ),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const CLASSIC_APP = "Use classic app (will be deprecated)"
const OLD_BETA = "Use new beta developer mode"
const assign = vi.fn()

/** What /m's app shell mounts on every page (`ContextSync`). */
const CookieSync = () => {
    useClassicModeCookieSync()
    return null
}

const readGateCookie = () =>
    document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(`${CLASSIC_MODE_COOKIE}=`))
        ?.slice(CLASSIC_MODE_COOKIE.length + 1)

/** The decision /m's proxy takes on the next document load, from the cookie as it stands. */
const nextLoadOfM = () =>
    decideMobileGate({
        pathname: "/",
        search: "",
        method: "GET",
        header: (name) => (name === "sec-fetch-dest" ? "document" : null),
        cookie: (name) => (name === CLASSIC_MODE_COOKIE ? readGateCookie() : undefined),
    })

let root: Root | undefined
let host: HTMLDivElement | undefined

/**
 * Signs `u1` in with Developer Mode on or off as an explicit choice, and the "Use classic app"
 * switch as stored, then renders the Preferences tab beside the cookie sync.
 */
const renderPreferences = ({
    developerMode,
    classicApp,
    beta,
    cookie,
}: {
    developerMode: boolean
    classicApp?: boolean
    /** The old "Use new beta developer mode" value, which nothing reads any more. */
    beta?: boolean
    cookie?: "0" | "1"
}) => {
    vi.stubGlobal("location", {...window.location, assign})
    if (cookie) document.cookie = `${CLASSIC_MODE_COOKIE}=${cookie}; path=/`
    if (classicApp !== undefined) {
        localStorage.setItem("agenta:settings:u1:classic-app", JSON.stringify(classicApp))
    }
    if (beta !== undefined) {
        localStorage.setItem("agenta:settings:u1:beta-developer-mode", JSON.stringify(beta))
    }
    const store = createStore()
    store.set(activeUserIdAtom, "u1")
    store.set(navSimplifiedOverrideAtom, !developerMode)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root!.render(
            <Provider store={store}>
                <CookieSync />
                <PreferencesTab />
            </Provider>,
        )
    })
    const switchFor = (label: string) =>
        host!.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${label}"]`)
    return {store, switchFor}
}

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    localStorage.clear()
    document.cookie = `${CLASSIC_MODE_COOKIE}=; path=/; max-age=0`
    vi.unstubAllGlobals()
    assign.mockReset()
})

describe("with Developer Mode on and the classic app off (the default)", () => {
    it("turns on every developer view and lists each page in the nav", () => {
        const {store, switchFor} = renderPreferences({developerMode: true})
        expect(switchFor(CLASSIC_APP)!.getAttribute("aria-checked")).toBe("false")
        expect(switchFor(OLD_BETA)).toBeNull()
        expect(store.get(enabledDeveloperViewsAtom)).toEqual(TEST_DEVELOPER_VIEWS)

        const [section] = developerNavItems("/p", store.get(enabledDeveloperViewsAtom)!)
        expect(section.submenu?.map((item) => item.link)).toEqual(["/p/lab-one", "/p/lab-two"])
    })

    it("stays in /m: the gate cookie says 0, so the next load of /m is not sent to /w", () => {
        renderPreferences({developerMode: true, cookie: "1"})
        expect(readGateCookie()).toBe("0")
        expect(nextLoadOfM()).toEqual({kind: "pass"})
        expect(assign).not.toHaveBeenCalled()
    })

    it("ignores the old beta developer mode value", () => {
        const {store} = renderPreferences({developerMode: true, beta: false})
        expect(readGateCookie()).toBe("0")
        expect(store.get(enabledDeveloperViewsAtom)).toEqual(TEST_DEVELOPER_VIEWS)
    })

    it("turning Developer Mode on stays in /m", () => {
        const {switchFor} = renderPreferences({developerMode: false})
        expect(switchFor(CLASSIC_APP)).toBeNull()
        act(() => switchFor("Developer mode")!.click())
        expect(assign).not.toHaveBeenCalled()
        expect(readGateCookie()).toBe("0")
        expect(switchFor(CLASSIC_APP)).not.toBeNull()
    })

    it("turning the classic app off again stays in /m", () => {
        const {switchFor} = renderPreferences({developerMode: true, classicApp: true, cookie: "1"})
        expect(nextLoadOfM().kind).toBe("redirect")

        act(() => switchFor(CLASSIC_APP)!.click())
        expect(assign).not.toHaveBeenCalled()
        expect(readGateCookie()).toBe("0")
        expect(nextLoadOfM()).toEqual({kind: "pass"})
    })
})

describe("with the classic app on", () => {
    it("turning it on sends the user to /w with Developer Mode on", () => {
        const {store, switchFor} = renderPreferences({developerMode: true})
        act(() => switchFor(CLASSIC_APP)!.click())
        expect(assign).toHaveBeenCalledWith("/w")
        expect(readGateCookie()).toBe("1")
        expect(localStorage.getItem("agenta:onboarding:u1:nav-simplified-override")).toBe("false")
        expect(localStorage.getItem("agenta:settings:u1:classic-app")).toBe("true")
        expect(store.get(enabledDeveloperViewsAtom)).toEqual([])
    })

    it("turning Developer Mode on sends the user to /w", () => {
        const {switchFor} = renderPreferences({developerMode: false, classicApp: true})
        act(() => switchFor("Developer mode")!.click())
        expect(assign).toHaveBeenCalledWith("/w")
        expect(readGateCookie()).toBe("1")
        expect(nextLoadOfM()).toEqual({kind: "redirect", location: "/w"})
    })
})
