// @vitest-environment jsdom
import {act} from "react"

import {activeUserIdAtom, navSimplifiedOverrideAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PreferencesTab} from "@/features/settings/PreferencesTab"

const assign = vi.fn()

vi.mock("@agenta/shared/hooks", () => ({
    desktopEscapeHref: () => "/w",
    writeClassicModeCookie: vi.fn(),
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

/** The same structure the desktop Preferences test asserts: the two apps must not drift. */
const EXPECTED_STRUCTURE = [
    {
        title: "Feature Flags",
        rows: ["Developer Mode", "Channels", "Agent apps", "In-process agent runtime"],
    },
    {title: "Debugging", rows: ["Playground inspector", "Channel debug", "Agenta channel probe"]},
]

const theme = {options: [{mode: "light", label: "Light"}], mode: "light", onSelect: () => undefined}

describe("mobile Preferences tab", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        vi.stubGlobal("location", {...window.location, assign})
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        const store = createStore()
        store.set(activeUserIdAtom, "u1")
        // A /m user is on the simplified surface: Developer Mode starts off.
        store.set(navSimplifiedOverrideAtom, true)
        act(() => {
            root.render(
                <Provider store={store}>
                    <PreferencesTab theme={theme} />
                </Provider>,
            )
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        localStorage.clear()
        vi.unstubAllGlobals()
        assign.mockReset()
    })

    it("renders Feature Flags and Debugging with every switch, no tags", () => {
        const structure = Array.from(host.querySelectorAll("[data-section]")).map((section) => ({
            title: section.querySelector("h2")?.textContent,
            rows: Array.from(section.querySelectorAll("[role=switch]")).map((s) =>
                s.getAttribute("aria-label"),
            ),
        }))
        expect(structure).toEqual(EXPECTED_STRUCTURE)
        expect(host.textContent).not.toMatch(/Experiments|Classic mode|\bBETA\b|\bDEBUG\b/)
    })

    it("turning Developer Mode on stores the classic-mode choice and leaves for the desktop", () => {
        const developerMode = host.querySelector<HTMLButtonElement>(
            '[role=switch][aria-label="Developer Mode"]',
        )!
        act(() => developerMode.click())
        expect(localStorage.getItem("agenta:onboarding:u1:nav-simplified-override")).toBe("false")
        expect(assign).toHaveBeenCalledWith("/w")
    })
})
