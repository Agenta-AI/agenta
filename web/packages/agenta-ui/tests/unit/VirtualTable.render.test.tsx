// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import type {ColumnDefs} from "../../src/InfiniteVirtualTable/columnDef"
import {VirtualTable} from "../../src/InfiniteVirtualTable/components/VirtualTable"

/**
 * React reports a missing `key` through console.error, and only ONCE per component type per
 * process, so these variants all run inside a single test: the second one to warn would be
 * swallowed if they were separate cases. Every configuration renders here, and any warning
 * from any of them fails the run.
 *
 * The bug this pins: `flexRender` returns an unkeyed element, and wherever one of those sits
 * beside a conditional sibling, React validates the pair as a list and complains.
 */

interface Row {
    key: string
    id: string
    name: string
}

const columns: ColumnDefs<Row> = [
    {key: "id", title: "ID", dataIndex: "id", width: 100},
    {key: "name", title: "Name", dataIndex: "name", width: 200},
]

const rows = (n: number): Row[] =>
    Array.from({length: n}, (_, i) => ({key: `r${i}`, id: `id-${i}`, name: `name ${i}`}))

const base = {
    columns,
    rowKey: (row: Row) => row.key,
    rowHeight: 40,
    height: 300,
} as const

// jsdom has no ResizeObserver; auto-layout measures its container with one.
class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

afterEach(cleanup)

describe("VirtualTable render warnings", () => {
    it("renders every configuration without React key warnings", () => {
        const seen: string[] = []
        const spy = vi
            .spyOn(console, "error")
            .mockImplementation((...args: unknown[]) =>
                seen.push(args.map((a) => String(a)).join(" ")),
            )

        const variants = [
            <VirtualTable<Row> {...base} dataSource={[]} emptyText="nothing" />,
            <VirtualTable<Row> {...base} dataSource={rows(5)} />,
            <VirtualTable<Row> {...base} dataSource={rows(5)} enableColumnResizing />,
            <VirtualTable<Row> {...base} dataSource={rows(5)} autoLayout />,
            <VirtualTable<Row>
                {...base}
                dataSource={rows(5)}
                leadingColumnWidth={48}
                renderLeadingHeader={() => <input type="checkbox" aria-label="all" />}
                renderLeadingCell={() => <input type="checkbox" aria-label="one" />}
            />,
            <VirtualTable<Row>
                {...base}
                dataSource={rows(5)}
                expanded={{r1: true}}
                renderExpandedRow={(record) => <div>panel for {record.id}</div>}
            />,
            <VirtualTable<Row>
                {...base}
                dataSource={rows(5)}
                columns={[
                    {key: "grp", title: "Group", children: columns} as ColumnDefs<Row>[number],
                ]}
            />,
        ]

        for (const variant of variants) {
            render(variant)
            cleanup()
        }

        spy.mockRestore()
        expect(seen.filter((message) => message.includes("unique"))).toEqual([])
    })

    it("shows a loading overlay and passes style through", () => {
        const {container, rerender} = render(
            <VirtualTable<Row>
                {...base}
                dataSource={rows(3)}
                loading
                style={{cursor: "pointer"}}
            />,
        )
        expect(container.querySelectorAll("[data-table-loading]")).toHaveLength(1)
        expect(container.querySelector(".avt-container")?.getAttribute("style")).toContain(
            "cursor: pointer",
        )

        rerender(<VirtualTable<Row> {...base} dataSource={rows(3)} />)
        expect(container.querySelectorAll("[data-table-loading]")).toHaveLength(0)
    })

    it("renders emptyText when there are no rows", () => {
        const {container} = render(
            <VirtualTable<Row> {...base} dataSource={[]} emptyText="no traces" />,
        )
        expect(container.textContent).toContain("no traces")
    })

    it("gives the header its own chrome, distinct from body cells", () => {
        const {container} = render(<VirtualTable<Row> {...base} dataSource={rows(3)} />)
        const head = container.querySelector(".avt-head-cell")?.className ?? ""
        const cell = container.querySelector(".avt-row td")?.className ?? ""
        // The header must not paint the same background as the body, or there is no chrome.
        // The header no longer paints a fill: the sticky header was made opaque against the
        // page surface instead (parity pass, §4c), so its chrome is the bottom rule + weight.
        expect(head).toContain("border-b")
        expect(head).toContain("font-medium")
        expect(cell).not.toContain("bg-colorFillQuaternary")
    })

    it("gives resize handles a grabbable hit area", () => {
        const {container} = render(
            <VirtualTable<Row> {...base} dataSource={rows(3)} enableColumnResizing />,
        )
        const handles = container.querySelectorAll(".avt-resize-handle")
        expect(handles.length).toBe(2)
        // w-1 (4px) was unusable in the app; the hit area must be wider than that.
        expect(handles[0].className).toContain("w-2")
    })

    it("keeps the header when there are no rows, so the empty state sits inside it", () => {
        const {container} = render(
            <VirtualTable<Row> {...base} dataSource={[]} emptyText="no traces" />,
        )
        expect(container.querySelectorAll(".avt-head-cell").length).toBe(2)
        expect(container.textContent).toContain("no traces")
    })
})
