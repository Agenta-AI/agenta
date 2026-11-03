// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import type {ColumnDefs} from "../../src/InfiniteVirtualTable/columnDef"
import {InfiniteVirtualTableFeatureShell} from "../../src/InfiniteVirtualTable/features"

/**
 * Both observability tables render through this shell, so the empty case has to keep its
 * chrome here too — a header that disappears with the rows takes the column controls with it.
 */

interface Row {
    key: string
    session_id: string
}

const columns: ColumnDefs<Row> = [
    {key: "session_id", title: "Session", dataIndex: "session_id", width: 200},
    {key: "extra", title: "Extra", dataIndex: "key", width: 120},
]

class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

afterEach(cleanup)

describe("InfiniteVirtualTableFeatureShell", () => {
    it("keeps the header when there are no rows, with the empty state inside it", () => {
        const client = new QueryClient()
        const {container} = render(
            <QueryClientProvider client={client}>
                <InfiniteVirtualTableFeatureShell<Row>
                    tableScope={{scopeId: "test", pageSize: 50}}
                    columns={columns}
                    rowKey="session_id"
                    pagination={{
                        rows: [],
                        loadNextPage: () => undefined,
                        resetPages: () => undefined,
                        paginationInfo: {
                            hasMore: false,
                            nextCursor: null,
                            nextOffset: null,
                            isFetching: false,
                            totalCount: 0,
                        },
                    }}
                    tableProps={{locale: {emptyText: "No sessions yet"}}}
                />
            </QueryClientProvider>,
        )

        expect(container.querySelectorAll(".avt-head-cell").length).toBeGreaterThan(0)
        expect(container.textContent).toContain("No sessions yet")
    })
})
