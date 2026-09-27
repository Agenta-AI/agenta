/**
 * The /w container for the Publish and Channels panels. The panel passes `onBack` once the
 * person has stepped past the first view (hub > Slack, Telegram or API); without a Back button
 * the only way out of a sub-view is to close the whole drawer.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {renderChannelsDrawer} from "./useAgentChannels"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

const mount = (onBack?: () => void) => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(
            renderChannelsDrawer({
                open: true,
                title: "Slack",
                subtitle: "Support agent",
                onClose: () => undefined,
                onBack,
                icon: <svg data-testid="panel-icon" />,
                children: <p>body</p>,
            }),
        )
    })
}

const backButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Back"]')

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    document.body.innerHTML = ""
})

describe("renderChannelsDrawer", () => {
    it("offers Back past the first view, and it steps back", () => {
        const onBack = vi.fn()
        mount(onBack)

        const back = backButton()
        expect(back, "no Back button on a sub-view").not.toBeNull()
        act(() => back!.click())
        expect(onBack).toHaveBeenCalledTimes(1)
    })

    it("shows no Back on the first view", () => {
        mount(undefined)

        expect(document.body.textContent).toContain("Slack")
        expect(backButton()).toBeNull()
    })

    it("shows the view's mark beside the title", () => {
        mount(undefined)

        expect(document.querySelector('[data-testid="panel-icon"]')).not.toBeNull()
    })
})
