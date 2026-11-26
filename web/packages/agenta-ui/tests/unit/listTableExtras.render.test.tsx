// @vitest-environment jsdom
import * as React from "react"

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ListTable} from "../../src/list-table/ListTable"
import {ListTableColumnsMenu} from "../../src/list-table/ListTableColumnsMenu"
import {ListTableExportButton} from "../../src/list-table/ListTableExportButton"
import {ListTableLoadMore} from "../../src/list-table/ListTableLoadMore"
import type {ListTableColumn, ListTableGroup} from "../../src/list-table/types"
import {useListTableColumnVisibility} from "../../src/list-table/useListTableColumnVisibility"

/**
 * The opt-in list features: CSV export, the column visibility menu, and the "Load more" row that
 * loads the next page when it scrolls into view. A list that asks for none of them is unchanged.
 */

// jsdom has no ResizeObserver; the Radix menu measures with one.
class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

interface Row {
    id: string
    name: string
    owner: string
    created: string
    updated: string
}

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "1fr"},
    {key: "owner", label: "Owner", width: "1fr"},
    {key: "created", label: "Created", width: "1fr"},
    {key: "updated", label: "Updated", width: "1fr"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

const ROWS: Row[] = [
    {id: "1", name: "Alpha, first", owner: "Alex", created: "Mon", updated: "Tue"},
    {id: "2", name: 'Beta "two"', owner: "Sam Lee", created: "Wed", updated: "Thu"},
]

const GROUPS: ListTableGroup<Row>[] = [{key: "all", label: null, rows: ROWS}]

describe("ListTable without the opt-in features", () => {
    it("draws the same header and rows and no export, columns or load more control", () => {
        render(
            <ListTable<Row>
                columns={COLUMNS}
                groups={GROUPS}
                rowKey={(row) => row.id}
                renderRow={(row) => (
                    <>
                        <span>{row.name}</span>
                        <span>{row.owner}</span>
                        <span>{row.created}</span>
                        <span>{row.updated}</span>
                        <span />
                    </>
                )}
            />,
        )
        expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
            "Name",
            "Owner",
            "Created",
            "Updated",
            "Actions",
        ])
        expect(screen.getByText("Alpha, first")).toBeTruthy()
        expect(screen.getByText('Beta "two"')).toBeTruthy()
        expect(screen.queryAllByRole("button")).toHaveLength(0)
        expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    })
})

describe("CSV export", () => {
    it("saves the rows the list passes as a CSV file", async () => {
        const saved: Blob[] = []
        vi.stubGlobal("URL", {
            ...URL,
            createObjectURL: (blob: Blob) => {
                saved.push(blob)
                return "blob:list"
            },
            revokeObjectURL: () => {},
        })
        let fileName = ""
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            fileName = this.download
        })
        render(
            <ListTableExportButton<Row>
                rows={ROWS}
                columns={[
                    {label: "Name", value: (row) => row.name},
                    {label: "Owner", value: (row) => row.owner},
                ]}
                fileName="test-sets"
            />,
        )
        fireEvent.click(screen.getByRole("button", {name: "Export CSV"}))
        expect(fileName).toBe("test-sets.csv")
        expect(saved).toHaveLength(1)
        const text = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            // Bytes, not `readAsText`: a text read drops the byte order mark this test checks.
            reader.onload = () =>
                resolve(
                    new TextDecoder("utf-8", {ignoreBOM: true}).decode(
                        reader.result as ArrayBuffer,
                    ),
                )
            reader.readAsArrayBuffer(saved[0])
        })
        expect(text).toBe('\uFEFFName,Owner\r\n"Alpha, first",Alex\r\n"Beta ""two""",Sam Lee')
    })

    it("cannot export an empty list", () => {
        render(
            <ListTableExportButton<Row>
                rows={[]}
                columns={[{label: "Name", value: (row) => row.name}]}
                fileName="test-sets"
            />,
        )
        expect(
            (screen.getByRole("button", {name: "Export CSV"}) as HTMLButtonElement).disabled,
        ).toBe(true)
    })
})

const ColumnsHarness = ({
    storageKey,
    columns = COLUMNS,
}: {
    storageKey: string
    columns?: ListTableColumn[]
}) => {
    const visibility = useListTableColumnVisibility({storageKey, columns})
    return (
        <>
            <ListTableColumnsMenu
                columns={columns}
                hiddenKeys={visibility.hiddenKeys}
                onChange={visibility.setColumnVisible}
            />
            <ListTable<Row>
                columns={visibility.visibleColumns}
                groups={GROUPS}
                rowKey={(row) => row.id}
                renderRow={(row) => (
                    <>
                        {visibility.isVisible("name") ? <span>{row.name}</span> : null}
                        {visibility.isVisible("owner") ? <span>{row.owner}</span> : null}
                        {visibility.isVisible("created") ? <span>{row.created}</span> : null}
                        {visibility.isVisible("updated") ? <span>{row.updated}</span> : null}
                        <span />
                    </>
                )}
            />
        </>
    )
}

const headers = () =>
    screen.getAllByRole("columnheader", {hidden: true}).map((cell) => cell.textContent)

const openColumnsMenu = () => {
    fireEvent.keyDown(screen.getByRole("button", {name: "Columns"}), {key: "Enter"})
    return screen.getByRole("menu")
}

describe("column visibility menu", () => {
    beforeEach(() => window.localStorage.clear())

    it("hides a column the reader unticks, and keeps it hidden after a reload", () => {
        const {unmount} = render(<ColumnsHarness storageKey="owner-hidden" />)
        const menu = openColumnsMenu()
        // Control columns are not offered.
        expect(within(menu).queryByRole("menuitemcheckbox", {name: "Actions"})).toBeNull()
        fireEvent.click(within(menu).getByRole("menuitemcheckbox", {name: "Owner"}))
        expect(headers()).toEqual(["Name", "Created", "Updated", "Actions"])
        expect(screen.queryByText("Alex")).toBeNull()
        expect(window.localStorage.getItem("agenta:list-table:hidden-columns:owner-hidden")).toBe(
            '["owner"]',
        )
        unmount()

        render(<ColumnsHarness storageKey="owner-hidden" />)
        expect(headers()).toEqual(["Name", "Created", "Updated", "Actions"])
    })

    it("shows a hidden column again when the reader ticks it", () => {
        window.localStorage.setItem("agenta:list-table:hidden-columns:show-again", '["created"]')
        render(<ColumnsHarness storageKey="show-again" />)
        expect(headers()).toEqual(["Name", "Owner", "Updated", "Actions"])
        fireEvent.click(within(openColumnsMenu()).getByRole("menuitemcheckbox", {name: "Created"}))
        expect(headers()).toEqual(["Name", "Owner", "Created", "Updated", "Actions"])
    })

    it("keeps one list's choice out of another list", () => {
        window.localStorage.setItem("agenta:list-table:hidden-columns:other-list", '["owner"]')
        render(<ColumnsHarness storageKey="this-list" />)
        expect(headers()).toEqual(["Name", "Owner", "Created", "Updated", "Actions"])
    })

    it("still hides a column when the browser blocks storage", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked")
        })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked")
        })
        render(<ColumnsHarness storageKey="blocked" />)
        fireEvent.click(within(openColumnsMenu()).getByRole("menuitemcheckbox", {name: "Owner"}))
        expect(headers()).toEqual(["Name", "Created", "Updated", "Actions"])
    })

    it("ignores stored data that is not a list of keys", () => {
        window.localStorage.setItem("agenta:list-table:hidden-columns:broken", "{not json")
        render(<ColumnsHarness storageKey="broken" />)
        expect(headers()).toEqual(["Name", "Owner", "Created", "Updated", "Actions"])
    })

    it("does not let the reader hide the last visible column", () => {
        window.localStorage.setItem(
            "agenta:list-table:hidden-columns:last-one",
            '["owner","created","updated"]',
        )
        render(<ColumnsHarness storageKey="last-one" />)
        const name = within(openColumnsMenu()).getByRole("menuitemcheckbox", {name: "Name"})
        expect(name.getAttribute("aria-disabled")).toBe("true")
    })

    it("is not drawn on a list with few columns", () => {
        render(<ColumnsHarness storageKey="narrow" columns={COLUMNS.slice(0, 3)} />)
        expect(screen.queryByRole("button", {name: "Columns"})).toBeNull()
    })
})

describe("Load more row", () => {
    const observers: {callback: IntersectionObserverCallback; disconnected: boolean}[] = []
    beforeEach(() => {
        observers.length = 0
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                record: {callback: IntersectionObserverCallback; disconnected: boolean}
                constructor(callback: IntersectionObserverCallback) {
                    this.record = {callback, disconnected: false}
                    observers.push(this.record)
                }
                observe() {}
                disconnect() {
                    this.record.disconnected = true
                }
            },
        )
    })

    const scrollIntoView = () =>
        act(() => {
            observers
                .filter((observer) => !observer.disconnected)
                .forEach((observer) =>
                    observer.callback(
                        [{isIntersecting: true} as IntersectionObserverEntry],
                        {} as IntersectionObserver,
                    ),
                )
        })

    it("loads the next page when the row scrolls into view", () => {
        const onLoadMore = vi.fn()
        render(<ListTableLoadMore onLoadMore={onLoadMore} autoLoad />)
        scrollIntoView()
        expect(onLoadMore).toHaveBeenCalledTimes(1)
    })

    it("does not load again while a page is loading", () => {
        const onLoadMore = vi.fn()
        render(<ListTableLoadMore onLoadMore={onLoadMore} autoLoad loading />)
        scrollIntoView()
        expect(onLoadMore).not.toHaveBeenCalled()
        expect(
            (screen.getByRole("button", {name: /Load more/}) as HTMLButtonElement).disabled,
        ).toBe(true)
    })

    it("waits for a click without autoLoad", () => {
        const onLoadMore = vi.fn()
        render(<ListTableLoadMore onLoadMore={onLoadMore} />)
        scrollIntoView()
        expect(onLoadMore).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", {name: "Load more"}))
        expect(onLoadMore).toHaveBeenCalledTimes(1)
    })

    it("keeps the button working in a browser with no IntersectionObserver", () => {
        vi.stubGlobal("IntersectionObserver", undefined)
        const onLoadMore = vi.fn()
        render(<ListTableLoadMore onLoadMore={onLoadMore} autoLoad />)
        fireEvent.click(screen.getByRole("button", {name: "Load more"}))
        expect(onLoadMore).toHaveBeenCalledTimes(1)
    })
})
