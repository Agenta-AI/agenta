import {act} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import Preferences from "./Preferences"

vi.mock("@/oss/components/Layout/ThemeContextProvider", () => ({
    ThemeMode: {Light: "light", Dark: "dark", System: "system"},
    useAppTheme: () => ({themeMode: "light", toggleAppTheme: () => {}}),
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

/** The same structure the /m Preferences tab test asserts: the two apps must not drift. */
const EXPECTED_STRUCTURE = [
    {title: "Feature Flags", rows: ["Developer Mode", "Channels", "Agent apps"]},
    {title: "Debugging", rows: ["Playground inspector", "Channel debug", "Agenta channel probe"]},
]

describe("Settings > Preferences", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        const store = createStore()
        store.set(activeUserIdAtom, "u1")
        act(() => {
            root.render(
                <Provider store={store}>
                    <Preferences />
                </Provider>,
            )
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        localStorage.clear()
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
        expect(host.textContent).toContain(
            "Show Evaluation, Prompt Management, and Tracing in the navigation.",
        )
    })

    it("stores Developer Mode on the existing classic-mode key", () => {
        const developerMode = host.querySelector<HTMLButtonElement>(
            '[role=switch][aria-label="Developer Mode"]',
        )!
        act(() => developerMode.click())
        expect(localStorage.getItem("agenta:onboarding:u1:nav-simplified-override")).toBe("true")
    })
})
