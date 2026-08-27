// @vitest-environment jsdom
import {act, cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {EnhancedModal} from "../../src/components/EnhancedModal"
import {EnhancedDrawer} from "../../src/drawer/EnhancedDrawer"

/**
 * `EnhancedDrawer` is an antd-`Drawer`-compatible facade, and two of the antd props its own
 * docstring listed as "deferred (rare / unused)" were in fact passed by real call-sites and
 * silently dropped — declared in the props interface, never destructured, with no `...rest` to
 * carry them:
 *
 *   - `closeIcon={null}` (`TestcaseDrawer`) — a drawer that asked for NO close button rendered one.
 *   - `classNames={{body}}` (`VirtualizedScenarioTableAnnotateDrawer`) — cancelled body padding
 *     stayed.
 *
 * Both need a drawer that is several steps of test data away in the app, and a render assertion is
 * the durable check anyway — a facade claiming antd parity should prove it, not assert it in a
 * comment.
 *
 * A third prop, `closeOnLayoutClick`, was ALSO read at one point — as "suppress outside-click
 * dismissal". That inverted its antd-era meaning (an ADDITIVE `.ant-layout` click listener for
 * maskless drawers; antd's `maskClosable` still dismissed on a backdrop click either way) and left
 * the ~18 drawers that pass `closeOnLayoutClick={false}` closable only via the X. The outside-click
 * suite below pins the restored behaviour on both the drawer and the modal.
 */

afterEach(cleanup)

const open = {open: true, title: "Drawer title", children: <div>body content</div>}

describe("EnhancedDrawer antd prop parity", () => {
    it("renders a close button by default", () => {
        render(<EnhancedDrawer {...open} />)
        expect(
            screen.getByRole("dialog").querySelector("[data-slot=sheet-header] button"),
        ).not.toBeNull()
    })

    it("closeIcon={null} hides the close button (antd's 'no close icon')", () => {
        render(<EnhancedDrawer {...open} closeIcon={null} />)
        expect(
            screen.getByRole("dialog").querySelector("[data-slot=sheet-header] button"),
        ).toBeNull()
    })

    it("closable={false} also hides it, and does not depend on closeIcon", () => {
        render(<EnhancedDrawer {...open} closable={false} />)
        expect(
            screen.getByRole("dialog").querySelector("[data-slot=sheet-header] button"),
        ).toBeNull()
    })

    it("classNames.body reaches the body slot", () => {
        render(<EnhancedDrawer {...open} classNames={{body: "test-body-class"}} />)
        const body = screen.getByRole("dialog").querySelector("[data-slot=drawer-body]")
        expect(body?.className).toContain("test-body-class")
        // The slot's own classes survive the merge — this is an addition, not a replacement.
        expect(body?.className).toContain("overflow-y-auto")
    })

    it("classNames.header and .footer reach their slots", () => {
        render(
            <EnhancedDrawer
                {...open}
                footer={<span>f</span>}
                classNames={{header: "hdr-x", footer: "ftr-x"}}
            />,
        )
        const dialog = screen.getByRole("dialog")
        expect(dialog.querySelector("[data-slot=sheet-header]")?.className).toContain("hdr-x")
        expect(dialog.querySelector("[data-slot=sheet-footer]")?.className).toContain("ftr-x")
    })

    it("styles.body still applies alongside classNames.body", () => {
        render(
            <EnhancedDrawer
                {...open}
                classNames={{body: "cls"}}
                styles={{body: {padding: "0px"}}}
            />,
        )
        const body = screen
            .getByRole("dialog")
            .querySelector("[data-slot=drawer-body]") as HTMLElement
        expect(body.className).toContain("cls")
        expect(body.style.padding).toBe("0px")
    })
})

/**
 * Outside-click dismissal. antd semantics: `maskClosable` (default `true`) is the ONLY switch;
 * `closeOnLayoutClick` never took dismissal away and must not here either.
 */
async function pointerDownOutside() {
    // Radix's dismissable layer registers its document listener in a setTimeout(0).
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
    })
    await act(async () => {
        // The full primary-button sequence, not just the pointerdown: Radix defers a
        // left-button dismissal to the following `click`, so a lone pointerdown never fires it.
        // jsdom has no PointerEvent constructor either; Radix reads only `pointerType` (undefined
        // here = the non-touch path a mouse takes in a browser), so MouseEvent stands in.
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
            document.body.dispatchEvent(new MouseEvent(type, {bubbles: true, button: 0}))
        }
    })
}

describe("EnhancedDrawer outside-click dismissal", () => {
    it("closes on an outside click by default", async () => {
        const onClose = vi.fn()
        render(<EnhancedDrawer {...open} onClose={onClose} />)
        await pointerDownOutside()
        expect(onClose).toHaveBeenCalled()
    })

    it("still closes when the legacy closeOnLayoutClick={false} is passed", async () => {
        const onClose = vi.fn()
        render(<EnhancedDrawer {...open} closeOnLayoutClick={false} onClose={onClose} />)
        await pointerDownOutside()
        expect(onClose).toHaveBeenCalled()
    })

    it("maskClosable={false} is the switch that suppresses it", async () => {
        const onClose = vi.fn()
        render(<EnhancedDrawer {...open} maskClosable={false} onClose={onClose} />)
        await pointerDownOutside()
        expect(onClose).not.toHaveBeenCalled()
    })

    it("maskClosable={false} wins even next to closeOnLayoutClick", async () => {
        const onClose = vi.fn()
        render(
            <EnhancedDrawer {...open} closeOnLayoutClick maskClosable={false} onClose={onClose} />,
        )
        await pointerDownOutside()
        expect(onClose).not.toHaveBeenCalled()
    })
})

/** The modal was never affected — it has no `closeOnLayoutClick` — but the question "does the
 * modal do this too?" is worth an answer that stays true. */
describe("EnhancedModal outside-click dismissal", () => {
    it("closes on an outside click by default", async () => {
        const onCancel = vi.fn()
        render(
            <EnhancedModal open title="t" onCancel={onCancel}>
                <div>body</div>
            </EnhancedModal>,
        )
        await pointerDownOutside()
        expect(onCancel).toHaveBeenCalled()
    })

    it("maskClosable={false} suppresses it", async () => {
        const onCancel = vi.fn()
        render(
            <EnhancedModal open title="t" maskClosable={false} onCancel={onCancel}>
                <div>body</div>
            </EnhancedModal>,
        )
        await pointerDownOutside()
        expect(onCancel).not.toHaveBeenCalled()
    })
})

/** `EnhancedModal` carried the same unread `classNames` as the drawer. Inert for today's call-sites
 * (they ask the footer for the flex/justify-end it already has), so this pins the wiring rather
 * than a fixed bug — the next slot someone passes should not vanish. */
describe("EnhancedModal antd prop parity", () => {
    it("classNames slots reach header, body and footer", () => {
        render(
            <EnhancedModal
                open
                title="Modal title"
                footer={<span>f</span>}
                classNames={{header: "hdr-y", body: "bdy-y", footer: "ftr-y"}}
            >
                <div>body</div>
            </EnhancedModal>,
        )
        const dialog = screen.getByRole("dialog")
        expect(dialog.querySelector("[data-slot=dialog-header]")?.className).toContain("hdr-y")
        expect(dialog.querySelector("[data-slot=modal-body]")?.className).toContain("bdy-y")
        expect(dialog.querySelector("[data-slot=dialog-footer]")?.className).toContain("ftr-y")
    })

    it("keeps the slot's own classes when merging", () => {
        render(
            <EnhancedModal open title="t" footer={<span>f</span>} classNames={{footer: "ftr-y"}}>
                <div>body</div>
            </EnhancedModal>,
        )
        const footer = screen.getByRole("dialog").querySelector("[data-slot=dialog-footer]")
        expect(footer?.className).toContain("ftr-y")
        expect(footer?.className).toContain("justify-end")
    })
})
