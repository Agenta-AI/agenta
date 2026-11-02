// @vitest-environment jsdom
import * as React from "react"

import {act, cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {Dialog, DialogContent, DialogTitle} from "../../src/components/ui/dialog"

// A contained dialog must close with its host drawer, or it outlives it as a page-level modal.
afterEach(cleanup)

function ContainedDialog({
    panel,
    contained,
    open,
    onOpenChange,
}: {
    panel: HTMLElement | null
    contained: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    return (
        <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
            <DialogContent container={panel} contained={contained && !!panel}>
                <DialogTitle>Dialog</DialogTitle>
            </DialogContent>
        </Dialog>
    )
}

function setup({contained, open = true}: {contained: boolean; open?: boolean}) {
    // Stands in for the drawer's Radix panel, which carries data-state open/closed.
    const panel = document.createElement("div")
    panel.setAttribute("data-state", "open")
    document.body.appendChild(panel)
    const onOpenChange = vi.fn()
    const {rerender} = render(
        <ContainedDialog
            panel={panel}
            contained={contained}
            open={open}
            onOpenChange={onOpenChange}
        />,
    )
    const closePanel = () =>
        act(async () => {
            panel.setAttribute("data-state", "closed")
            // MutationObserver callbacks run as microtasks.
            await Promise.resolve()
        })
    // The MCP section's shape: the same render that closes the drawer drops its panel.
    const closePanelAndDropIt = () =>
        act(() => {
            panel.setAttribute("data-state", "closed")
            rerender(
                <ContainedDialog
                    panel={null}
                    contained={contained}
                    open={open}
                    onOpenChange={onOpenChange}
                />,
            )
        })
    return {onOpenChange, closePanel, closePanelAndDropIt}
}

describe("contained Dialog", () => {
    it("closes when its host panel closes", async () => {
        const {onOpenChange, closePanel} = setup({contained: true})
        expect(onOpenChange).not.toHaveBeenCalled()

        await closePanel()

        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("closes when the caller drops the panel in the render that closes it", () => {
        const {onOpenChange, closePanelAndDropIt} = setup({contained: true})

        closePanelAndDropIt()

        expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("leaves an already-closed dialog alone when its host closes", async () => {
        // The always-mounted shape, e.g. the version history drawer's revert confirm.
        const {onOpenChange, closePanel} = setup({contained: true, open: false})

        await closePanel()

        expect(onOpenChange).not.toHaveBeenCalled()
    })

    it("leaves a dialog that only portals into the panel alone", async () => {
        const {onOpenChange, closePanel} = setup({contained: false})

        await closePanel()

        expect(onOpenChange).not.toHaveBeenCalled()
    })
})
