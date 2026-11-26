// @vitest-environment jsdom
import {act, useEffect} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const seen = vi.hoisted(() => ({render: [] as string[], effect: [] as string[]}))

// Analytics starts in an effect, so the address an effect sees is the first one PostHog can read.
vi.mock("@/features/context/ContextResolver", () => ({
    ContextResolver: () => {
        seen.render.push(window.location.href)
        useEffect(() => {
            seen.effect.push(window.location.href)
        }, [])
        return null
    },
}))

import {forgetLicenseKey, peekLicenseKey} from "@/lib/context"
import SettingsRedirect from "@/pages/settings"

describe("the /m/settings activation link", () => {
    let root: Root | undefined

    afterEach(() => {
        act(() => root?.unmount())
        root = undefined
        forgetLicenseKey()
        window.history.replaceState(null, "", "/")
    })

    it("drops the key from the address during the first render, before any effect runs", () => {
        window.history.replaceState(null, "", "/m/settings?tab=license#key=agenta_license_v1.a.b")
        const container = document.createElement("div")

        act(() => {
            root = createRoot(container)
            root.render(<SettingsRedirect />)
        })

        expect(seen.render.length).toBeGreaterThan(0)
        for (const href of [...seen.render, ...seen.effect]) expect(href).not.toContain("key=")
        expect(window.location.href).toMatch(/\/m\/settings\?tab=license$/)
        expect(peekLicenseKey()).toBe("agenta_license_v1.a.b")
    })
})
