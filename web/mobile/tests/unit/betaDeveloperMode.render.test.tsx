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

const BETA = "Use new beta developer mode"
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
 * Signs `u1` in with Developer Mode on or off as an explicit choice, and the beta switch as
 * stored, then renders the Preferences tab beside the cookie sync. `offered` is the deployment's
 * `AGENTA_BETA_DEVELOPER_MODE`, as `__env.js` carries it.
 */
const renderPreferences = ({
    developerMode,
    beta,
    cookie,
    offered = true,
}: {
    developerMode: boolean
    beta: boolean
    cookie?: "0" | "1"
    offered?: boolean
}) => {
    vi.stubGlobal("location", {...window.location, assign})
    vi.stubGlobal("__env", offered ? {NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE: "true"} : {})
    if (cookie) document.cookie = `${CLASSIC_MODE_COOKIE}=${cookie}; path=/`
    localStorage.setItem("agenta:settings:u1:beta-developer-mode", JSON.stringify(beta))
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

describe("beta developer mode switch", () => {
    it("shows only while Developer Mode is on", () => {
        const {switchFor} = renderPreferences({developerMode: false, beta: false})
        expect(switchFor(BETA)).toBeNull()

        act(() => switchFor("Developer Mode")!.click())
        expect(switchFor(BETA)).not.toBeNull()

        act(() => switchFor("Developer Mode")!.click())
        expect(switchFor(BETA)).toBeNull()
    })

    it("sits right under Developer Mode, before the preview switches", () => {
        const {switchFor} = renderPreferences({developerMode: true, beta: false})
        expect(switchFor(BETA)).not.toBeNull()
        const rows = Array.from(
            host!.querySelectorAll('[data-section="feature-flags"] [role=switch]'),
        ).map((row) => row.getAttribute("aria-label"))
        expect(rows).toEqual(["Developer Mode", BETA, "Lab preview", "Lab gate"])
    })
})

describe("with Developer Mode and beta developer mode on", () => {
    it("turns on every developer view, whatever its stage, and lists each in the nav", () => {
        const {store, switchFor} = renderPreferences({developerMode: true, beta: true})
        expect(switchFor(BETA)!.getAttribute("aria-checked")).toBe("true")
        expect(store.get(enabledDeveloperViewsAtom)).toEqual(TEST_DEVELOPER_VIEWS)

        const [section] = developerNavItems("/p", store.get(enabledDeveloperViewsAtom)!)
        expect(section.submenu?.map((item) => item.link)).toEqual([
            "/p/lab-hidden",
            "/p/lab-preview",
            "/p/lab-on",
        ])
        // Every view is already on: a preview switch would change nothing.
        expect(switchFor("Lab preview")).toBeNull()
    })

    it("stays in /m: the gate cookie says 0, so the next load of /m is not sent to /w", () => {
        renderPreferences({developerMode: true, beta: true, cookie: "1"})
        expect(readGateCookie()).toBe("0")
        expect(nextLoadOfM()).toEqual({kind: "pass"})
        expect(assign).not.toHaveBeenCalled()
    })

    it("turning beta on stays in /m", () => {
        const {switchFor} = renderPreferences({developerMode: true, beta: false, cookie: "1"})
        expect(nextLoadOfM().kind).toBe("redirect")

        act(() => switchFor(BETA)!.click())
        expect(assign).not.toHaveBeenCalled()
        expect(readGateCookie()).toBe("0")
        expect(nextLoadOfM()).toEqual({kind: "pass"})
    })

    it("turning Developer Mode on with beta stored on stays in /m", () => {
        const {switchFor} = renderPreferences({developerMode: false, beta: true, cookie: "0"})
        act(() => switchFor("Developer Mode")!.click())
        expect(assign).not.toHaveBeenCalled()
        expect(nextLoadOfM()).toEqual({kind: "pass"})
    })
})

describe("with beta developer mode off", () => {
    it("turning Developer Mode on sends the user to /w, as before", () => {
        const {switchFor} = renderPreferences({developerMode: false, beta: false, cookie: "0"})
        act(() => switchFor("Developer Mode")!.click())
        expect(assign).toHaveBeenCalledWith("/w")
        expect(readGateCookie()).toBe("1")
        expect(nextLoadOfM()).toEqual({kind: "redirect", location: "/w"})
    })

    it("turning beta off sends the user to /w with Developer Mode on", () => {
        const {store, switchFor} = renderPreferences({developerMode: true, beta: true})
        act(() => switchFor(BETA)!.click())
        expect(assign).toHaveBeenCalledWith("/w")
        expect(readGateCookie()).toBe("1")
        expect(localStorage.getItem("agenta:onboarding:u1:nav-simplified-override")).toBe("false")
        expect(store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)).toEqual(["lab-on"])
    })
})

describe("when the deployment does not offer beta developer mode", () => {
    it("hides the switch, even with Developer Mode on", () => {
        const {switchFor} = renderPreferences({developerMode: true, beta: false, offered: false})
        expect(switchFor("Developer Mode")).not.toBeNull()
        expect(switchFor(BETA)).toBeNull()
    })

    it("ignores a beta switch the user stored on: Developer Mode sends them to /w, as before", () => {
        const {store, switchFor} = renderPreferences({
            developerMode: false,
            beta: true,
            cookie: "0",
            offered: false,
        })
        act(() => switchFor("Developer Mode")!.click())
        expect(assign).toHaveBeenCalledWith("/w")
        expect(readGateCookie()).toBe("1")
        expect(nextLoadOfM()).toEqual({kind: "redirect", location: "/w"})
        // The views follow their stage again, not "every view".
        expect(store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)).toEqual(["lab-on"])
        expect(switchFor(BETA)).toBeNull()
    })

    it("publishes 1 for Developer Mode with beta stored on, so /m sends the user to /w", () => {
        renderPreferences({developerMode: true, beta: true, offered: false})
        expect(readGateCookie()).toBe("1")
        expect(nextLoadOfM()).toEqual({kind: "redirect", location: "/w"})
    })
})
