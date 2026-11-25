// @vitest-environment jsdom
/**
 * A connection's row menu offers Revoke and Delete only to someone allowed to change the
 * connection. A read-only member on the project's rows must not be offered either.
 */
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ConnectionRowMenu} from "../../src/DrillInView/SchemaControls/agentTemplate/ConnectionRowMenu"

afterEach(cleanup)

const open = () => {
    act(() => {
        fireEvent.pointerDown(screen.getByRole("button"), {bubbles: true, button: 0})
    })
}

const items = () => screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())

describe("ConnectionRowMenu", () => {
    it("offers Revoke and Delete when the person may change the connection", () => {
        render(<ConnectionRowMenu onRefresh={vi.fn()} onRevoke={vi.fn()} onDelete={vi.fn()} />)
        open()
        expect(items()).toEqual(["Refresh", "Revoke", "Delete"])
    })

    it("offers only Refresh to a read-only member", () => {
        render(<ConnectionRowMenu onRefresh={vi.fn()} />)
        open()
        expect(items()).toEqual(["Refresh"])
    })
})
