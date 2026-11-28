// @vitest-environment jsdom
import React, {act} from "react"

import {activeUserIdAtom, navSimplifiedOverrideAtom} from "@agenta/shared/state"
import {CLASSIC_MODE_COOKIE, decideMobileGate} from "@agenta/shared/utils/mobileGate"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Radix's switch is not what these tests check: a plain button carries the same contract.
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

import {
    PREFERENCE_SECTIONS,
    PreferencesPage,
    usePreferenceBindings,
    type PreferenceBindings,
} from "../../src/PreferencesPage"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const theme = {options: [{mode: "light", label: "Light"}], mode: "light", onSelect: () => undefined}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
})

const BoundPage = () => <PreferencesPage theme={theme} bindings={usePreferenceBindings()} />

const renderBound = ({developerMode}: {developerMode?: boolean} = {}) => {
    const store = createStore()
    store.set(activeUserIdAtom, "u1")
    if (developerMode !== undefined) store.set(navSimplifiedOverrideAtom, !developerMode)
    act(() => {
        root.render(
            <Provider store={store}>
                <BoundPage />
            </Provider>,
        )
    })
}

const structure = () =>
    Array.from(host.querySelectorAll("[data-section]")).map((section) => ({
        title: section.querySelector("h2")?.textContent,
        rows: Array.from(section.querySelectorAll("[role=switch]")).map((s) =>
            s.getAttribute("aria-label"),
        ),
    }))

describe("PreferencesPage", () => {
    it("shows Feature Flags then Debugging, in the shared order", () => {
        renderBound()
        expect(structure()).toEqual([
            {
                title: "Feature flags",
                rows: ["Developer mode", "Use classic app (will be deprecated)"],
            },
            {
                title: "Debugging",
                rows: ["Playground inspector", "Channel debug", "Agenta channel probe"],
            },
        ])
        expect(host.textContent).not.toContain("Experiments")
    })

    it("carries no BETA or DEBUG tags", () => {
        renderBound()
        expect(host.textContent).not.toMatch(/\bBETA\b|\bDEBUG\b/)
    })

    it("keeps every switch on its existing storage key", () => {
        renderBound()
        for (const s of Array.from(host.querySelectorAll<HTMLButtonElement>("[role=switch]"))) {
            act(() => s.click())
        }
        const keys = Object.keys(localStorage).sort()
        expect(keys).toEqual(
            [
                "agenta:onboarding:active-user-id",
                "agenta:onboarding:u1:nav-simplified-override",
                "agenta:settings:u1:agenta-channel-surface",
                "agenta:settings:u1:channel-debug",
                "agenta:settings:u1:playground-inspector",
            ].sort(),
        )
    })

    it("drops unbound rows and sections left empty", () => {
        const bindings: PreferenceBindings = {
            "playground-inspector": {enabled: false, onChange: () => {}},
        }
        act(() => root.render(<PreferencesPage theme={theme} bindings={bindings} />))
        expect(structure()).toEqual([{title: "Debugging", rows: ["Playground inspector"]}])
    })

    it("gives every row a one-line description", () => {
        for (const section of PREFERENCE_SECTIONS) {
            for (const item of section.items) {
                expect(item.description).not.toContain("\n")
                expect(item.description.split(". ").length).toBe(1)
            }
        }
    })
})

describe("the classic app switch on the desktop", () => {
    const CLASSIC_APP = "Use classic app (will be deprecated)"
    const replace = vi.fn()
    const classicAppSwitch = () =>
        host.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${CLASSIC_APP}"]`)
    const readGateCookie = () =>
        document.cookie
            .split("; ")
            .find((entry) => entry.startsWith(`${CLASSIC_MODE_COOKIE}=`))
            ?.slice(CLASSIC_MODE_COOKIE.length + 1)

    beforeEach(() => {
        vi.stubGlobal("location", {
            ...window.location,
            pathname: "/w/ws1/p/p1/settings",
            search: "?tab=preferences",
            replace,
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        replace.mockReset()
        document.cookie = `${CLASSIC_MODE_COOKIE}=; path=/; max-age=0`
    })

    it("replaces the old beta developer mode switch and is off by default", () => {
        localStorage.setItem("agenta:settings:u1:beta-developer-mode", "true")
        renderBound({developerMode: true})
        expect(
            host.querySelector('[role=switch][aria-label="Use new beta developer mode"]'),
        ).toBeNull()
        expect(classicAppSwitch()!.getAttribute("aria-checked")).toBe("false")
        expect(host.textContent).toContain(
            "Developer mode opens the classic app instead of the Developer section.",
        )
    })

    it("shows only while Developer Mode is on", () => {
        renderBound({developerMode: false})
        expect(classicAppSwitch()).toBeNull()

        const developerMode = host.querySelector<HTMLButtonElement>(
            '[role=switch][aria-label="Developer mode"]',
        )!
        act(() => developerMode.click())
        expect(classicAppSwitch()).not.toBeNull()
        expect(replace).not.toHaveBeenCalled()
    })

    it("turning it on keeps the user here with Developer Mode on as a choice", () => {
        renderBound({developerMode: true})
        act(() => classicAppSwitch()!.click())
        expect(replace).not.toHaveBeenCalled()
        expect(localStorage.getItem("agenta:onboarding:u1:nav-simplified-override")).toBe("false")
        expect(localStorage.getItem("agenta:settings:u1:classic-app")).toBe("true")
    })

    it("turning it off sends the user to /m and clears the cookie, so /m does not send them back", () => {
        document.cookie = `${CLASSIC_MODE_COOKIE}=1; path=/`
        localStorage.setItem("agenta:settings:u1:classic-app", "true")
        renderBound({developerMode: true})
        act(() => classicAppSwitch()!.click())

        expect(localStorage.getItem("agenta:settings:u1:classic-app")).toBe("false")
        expect(readGateCookie()).toBeUndefined()
        const target: string = replace.mock.calls[0][0]
        expect(target.startsWith("/m/")).toBe(true)
        // What /m's proxy decides on arrival, with the cookie as it stands now.
        const url = new URL(target, "http://localhost")
        expect(
            decideMobileGate({
                pathname: url.pathname.replace(/^\/m(?=\/)/, ""),
                search: url.search,
                method: "GET",
                header: (name) => (name === "sec-fetch-dest" ? "document" : null),
                cookie: (name) => (name === CLASSIC_MODE_COOKIE ? readGateCookie() : undefined),
            }),
        ).toEqual({kind: "pass"})
    })
})
