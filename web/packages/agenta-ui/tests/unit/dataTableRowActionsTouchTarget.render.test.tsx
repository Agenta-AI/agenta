// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {DataTable} from "../../src/components/ui/data-table"
import {TOUCH_TARGET_MINIMUM_PX, touchTargetHeight} from "../../src/components/ui/touch-target"

/**
 * The row-actions kebab is the only route to a row's verbs — on the MCP registry that is
 * Reconnect, View tools, Rename, Disconnect and Remove — and it was 24px tall, which a finger
 * misses. It keeps the 24px chrome, because at 28 it was the tallest thing in the row and pushed
 * every table row from 41px to 45, and grows an invisible box to the 44px minimum instead.
 *
 * Asserted through `touchTargetHeight` rather than against the class string, so a later change to
 * the button's height class has to change the expansion with it or this fails.
 */

interface Row {
    id: string
    name: string
}

const rows: Row[] = [{id: "one", name: "Acme"}]

const renderTable = () =>
    render(
        <DataTable<Row>
            columns={[{key: "name", title: "Name", render: (record) => record.name}]}
            rows={rows}
            rowKey={(record) => record.id}
            actions={() => [{key: "rename", label: "Rename", onClick: () => undefined}]}
        />,
    )

afterEach(cleanup)

describe("the table's row-actions kebab", () => {
    it("has a 44px hit area while keeping its 24px chrome", () => {
        const {container} = renderTable()

        const kebab = container.querySelector<HTMLButtonElement>('button[aria-label="Row actions"]')
        expect(kebab, "no row-actions trigger").not.toBeNull()
        expect(kebab!.className).toContain("h-6")
        expect(touchTargetHeight(kebab!.className)).toBe(TOUCH_TARGET_MINIMUM_PX)
    })

    it("gains the hit area with nothing a reader can see", () => {
        // Every table in the product renders this trigger, so the expansion had to be invisible
        // rather than gated behind a prop no existing caller passes.
        const {container} = renderTable()

        const kebab = container.querySelector<HTMLButtonElement>('button[aria-label="Row actions"]')
        expect(kebab!.className).toContain("w-[30px]")
        expect(kebab!.className).toContain("bg-transparent")
        expect(kebab!.className).not.toMatch(/after:(bg|border|text|shadow)-/)
    })
})
