// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import type {ReactNode} from "react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {PageTitle} from "../../src/page-title"

/**
 * The whole fix for the flapping tab title is the `undefined` vs `""`/`null` distinction: a title
 * that has not loaded yet must emit NO `<title>`, so Next's head dedupe leaves the standing title
 * alone rather than dropping the tab to the bare product name for a frame. React 19 hoists a
 * rendered `<title>` into the real document head, so `document.title` is what the tab shows.
 */
vi.mock("next/head", () => ({
    default: ({children}: {children: ReactNode}) => <>{children}</>,
}))

afterEach(() => {
    cleanup()
    document.title = "standing"
})

const tabTitle = (ui: Parameters<typeof render>[0]) => {
    document.title = "standing"
    render(ui)
    return document.title
}

describe("PageTitle", () => {
    it("emits nothing while the title is unresolved", () => {
        expect(tabTitle(<PageTitle />)).toBe("standing")
        expect(tabTitle(<PageTitle context="My Agent" />)).toBe("standing")
    })

    it("emits the default when the screen genuinely names nothing", () => {
        expect(tabTitle(<PageTitle title={null} />)).toBe("Agenta")
        expect(tabTitle(<PageTitle title="" />)).toBe("Agenta")
    })

    it("emits the formatted title once it resolves", () => {
        expect(tabTitle(<PageTitle title="Session one" context="My Agent" />)).toBe(
            "Session one | My Agent",
        )
        expect(tabTitle(<PageTitle title="Settings" />)).toBe("Settings | Agenta")
    })
})
