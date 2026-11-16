// @vitest-environment jsdom
import {act} from "react"

import {activeUserIdAtom, navSimplifiedOverrideAtom} from "@agenta/shared/state"
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

const assign = vi.fn()

let root: Root | undefined
let host: HTMLDivElement | undefined

/** Signs `u1` in with Developer Mode on or off as an explicit choice, then renders Preferences. */
const renderPreferences = ({developerMode}: {developerMode: boolean}) => {
    vi.stubGlobal("location", {...window.location, assign})
    const store = createStore()
    store.set(activeUserIdAtom, "u1")
    store.set(navSimplifiedOverrideAtom, !developerMode)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root!.render(
            <Provider store={store}>
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
    vi.unstubAllGlobals()
    assign.mockReset()
})

describe("Preferences feature flags", () => {
    it("list Developer Mode and the preview views, with no beta switch", () => {
        renderPreferences({developerMode: false})
        const rows = Array.from(
            host!.querySelectorAll('[data-section="feature-flags"] [role=switch]'),
        ).map((row) => row.getAttribute("aria-label"))
        expect(rows).toEqual(["Developer Mode", "Lab preview", "Lab gate"])
    })
})

describe("with Developer Mode on", () => {
    it("turns on every developer view, whatever its stage, and lists each in the nav", () => {
        const {store, switchFor} = renderPreferences({developerMode: true})
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
})

describe("turning Developer Mode on", () => {
    it("stays in /m and turns on every developer view", () => {
        const {store, switchFor} = renderPreferences({developerMode: false})
        expect(store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)).toEqual(["lab-on"])

        act(() => switchFor("Developer Mode")!.click())
        expect(assign).not.toHaveBeenCalled()
        expect(localStorage.getItem("agenta:onboarding:u1:nav-simplified-override")).toBe("false")
        expect(store.get(enabledDeveloperViewsAtom)).toEqual(TEST_DEVELOPER_VIEWS)
    })
})

describe("with Developer Mode off", () => {
    it("keeps the views on their stage", () => {
        const {store} = renderPreferences({developerMode: false})
        expect(store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)).toEqual(["lab-on"])
    })
})
