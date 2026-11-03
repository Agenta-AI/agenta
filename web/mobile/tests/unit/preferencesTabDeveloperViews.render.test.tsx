// @vitest-environment jsdom
import {act} from "react"

import {activeUserIdAtom, navSimplifiedOverrideAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {enabledDeveloperViewsAtom} from "@/features/developer/developerViewAccess"
import {PreferencesTab} from "@/features/settings/PreferencesTab"

vi.mock("@/features/developer/developerViews", async () => ({
    DEVELOPER_VIEWS: (await import("./developerViewFixtures")).TEST_DEVELOPER_VIEWS,
}))

vi.mock("@agenta/shared/hooks", () => ({
    desktopEscapeHref: () => "/w",
    writeClassicModeCookie: vi.fn(),
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

/**
 * The shared structure (preferencesTab.render.test.tsx) holds with an empty registry; a view in
 * preview adds one Feature Flags switch each, after the shared rows.
 */
describe("mobile Preferences tab with a developer view in preview", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
        store.set(activeUserIdAtom, "u1")
        store.set(navSimplifiedOverrideAtom, true)
        act(() => {
            root.render(
                <Provider store={store}>
                    <PreferencesTab />
                </Provider>,
            )
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        localStorage.clear()
    })

    it("lists the preview views, and only them, under Feature Flags", () => {
        const featureFlags = host.querySelector('[data-section="feature-flags"]')!
        const rows = Array.from(featureFlags.querySelectorAll("[role=switch]")).map((s) =>
            s.getAttribute("aria-label"),
        )
        expect(rows).toEqual(["Developer Mode", "Lab preview", "Lab gate"])
    })

    it("turning the switch on enables the view for this user", () => {
        const toggle = host.querySelector<HTMLButtonElement>(
            '[role=switch][aria-label="Lab preview"]',
        )!
        expect(store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)).toEqual(["lab-on"])
        act(() => toggle.click())
        expect(toggle.getAttribute("aria-checked")).toBe("true")
        expect(store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)).toEqual([
            "lab-preview",
            "lab-on",
        ])
    })
})
