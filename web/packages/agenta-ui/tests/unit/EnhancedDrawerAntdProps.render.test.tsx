// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {EnhancedDrawer} from "../../src/drawer/EnhancedDrawer"

/**
 * `EnhancedDrawer` is an antd-`Drawer`-compatible facade, and three of the antd props its own
 * docstring listed as "deferred (rare / unused)" were in fact passed by real call-sites and
 * silently dropped — declared in the props interface, never destructured, with no `...rest` to
 * carry them:
 *
 *   - `closeOnLayoutClick={false}` (13 call-sites) — every one of those drawers dismissed on a
 *     stray outside click despite asking not to, losing typed input on the form ones.
 *   - `closeIcon={null}` (`TestcaseDrawer`) — a drawer that asked for NO close button rendered one.
 *   - `classNames={{body}}` (`VirtualizedScenarioTableAnnotateDrawer`) — cancelled body padding
 *     stayed.
 *
 * The outside-click one was verified against the deployed build (prod closes, this build stays
 * open). The other two are pinned here instead: both need a drawer that is several steps of test
 * data away in the app, and a render assertion is the durable check anyway — a facade claiming
 * antd parity should prove it, not assert it in a comment.
 */

afterEach(cleanup)

const open = {open: true, title: "Drawer title", children: <div>body content</div>}

describe("EnhancedDrawer antd prop parity", () => {
    it("renders a close button by default", () => {
        render(<EnhancedDrawer {...open} />)
        expect(screen.getByRole("dialog").querySelector("[data-slot=sheet-header] button")).not.toBeNull()
    })

    it("closeIcon={null} hides the close button (antd's 'no close icon')", () => {
        render(<EnhancedDrawer {...open} closeIcon={null} />)
        expect(screen.getByRole("dialog").querySelector("[data-slot=sheet-header] button")).toBeNull()
    })

    it("closable={false} also hides it, and does not depend on closeIcon", () => {
        render(<EnhancedDrawer {...open} closable={false} />)
        expect(screen.getByRole("dialog").querySelector("[data-slot=sheet-header] button")).toBeNull()
    })

    it("classNames.body reaches the body slot", () => {
        render(<EnhancedDrawer {...open} classNames={{body: "test-body-class"}} />)
        const body = screen.getByRole("dialog").querySelector("[data-slot=drawer-body]")
        expect(body?.className).toContain("test-body-class")
        // The slot's own classes survive the merge — this is an addition, not a replacement.
        expect(body?.className).toContain("overflow-y-auto")
    })

    it("classNames.header and .footer reach their slots", () => {
        render(<EnhancedDrawer {...open} footer={<span>f</span>} classNames={{header: "hdr-x", footer: "ftr-x"}} />)
        const dialog = screen.getByRole("dialog")
        expect(dialog.querySelector("[data-slot=sheet-header]")?.className).toContain("hdr-x")
        expect(dialog.querySelector("[data-slot=sheet-footer]")?.className).toContain("ftr-x")
    })

    it("styles.body still applies alongside classNames.body", () => {
        render(<EnhancedDrawer {...open} classNames={{body: "cls"}} styles={{body: {padding: "0px"}}} />)
        const body = screen.getByRole("dialog").querySelector("[data-slot=drawer-body]") as HTMLElement
        expect(body.className).toContain("cls")
        expect(body.style.padding).toBe("0px")
    })
})
