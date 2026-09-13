// @vitest-environment jsdom
import {atom} from "jotai"
import {Provider} from "jotai"
import {flushSync} from "react-dom"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PreferencesTab} from "@/features/settings/PreferencesTab"

vi.mock("@agenta/settings-ui", () => ({
    PreferencesPage: ({flags}: {flags: {title: string}[]}) => (
        <div>{flags.map(({title}) => title).join(", ")}</div>
    ),
}))

vi.mock("@agenta/shared/hooks", () => ({
    desktopEscapeHref: () => "/",
    writeClassicModeCookie: vi.fn(),
}))

vi.mock("@agenta/shared/state", () => ({
    classicModeEnabledAtom: atom(false),
}))

describe("mobile preferences", () => {
    let host: HTMLDivElement
    let root: Root

    beforeEach(() => {
        Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })

    afterEach(() => {
        flushSync(() => root.unmount())
        host.remove()
    })

    it("does not offer the desktop-only Playground inspector flag", () => {
        flushSync(() => {
            root.render(
                <Provider>
                    <PreferencesTab
                        theme={{
                            options: [{mode: "system", label: "System"}],
                            mode: "system",
                            onSelect: vi.fn(),
                        }}
                    />
                </Provider>,
            )
        })

        expect(host.textContent).toContain("Classic mode")
        expect(host.textContent).not.toContain("Playground inspector")
    })
})
