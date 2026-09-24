// @vitest-environment jsdom
import React, {act} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
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
})

const BoundPage = () => <PreferencesPage theme={theme} bindings={usePreferenceBindings()} />

const renderBound = () => {
    const store = createStore()
    store.set(activeUserIdAtom, "u1")
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
            {title: "Feature Flags", rows: ["Developer Mode", "Channels", "Agent apps"]},
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
                "agenta:settings:u1:agent-apps",
                "agenta:settings:u1:agenta-channel-surface",
                "agenta:settings:u1:channel-debug",
                "agenta:settings:u1:channels",
                "agenta:settings:u1:playground-inspector",
            ].sort(),
        )
    })

    it("drops unbound rows and sections left empty", () => {
        const bindings: PreferenceBindings = {channels: {enabled: false, onChange: () => {}}}
        act(() => root.render(<PreferencesPage theme={theme} bindings={bindings} />))
        expect(structure()).toEqual([{title: "Feature Flags", rows: ["Channels"]}])
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
