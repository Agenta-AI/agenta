import {useCallback, useState} from "react"

import {InfiniteVirtualTable} from "@agenta/ui/table"
import {Badge} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import type {ColumnsType} from "antd/es/table"

/**
 * InfiniteVirtualTable — the @agenta/ui virtualized data grid engine
 * (`@agenta/ui/table`, `@agenta/ui/table/paginated`).
 *
 * In the app this is driven by a Jotai store + TanStack Query fetchers (infinite
 * scroll, windowing, column visibility, row selection). This story strips ALL of
 * that away: it feeds the component a FIXED in-memory array via the plain
 * `dataSource`/`columns`/`rowKey` props and a no-op `loadMore`, so the presentational
 * grid can be seen in isolation with no live fetching. This is the seam we want to
 * study: the props here (columns + rows + loadMore) are the presentational contract;
 * everything else (store, fetchers, pagination) is data logic layered on top.
 */

interface EvalRow {
    key: string
    name: string
    status: "success" | "error" | "running" | "pending"
    score: number
    latencyMs: number
    createdBy: string
    createdAt: string
}

const STATUS_VARIANT: Record<EvalRow["status"], "success" | "error" | "processing" | "warning"> = {
    success: "success",
    error: "error",
    running: "processing",
    pending: "warning",
}

const NAMES = [
    "gpt-4o baseline",
    "claude-sonnet retrieval",
    "few-shot classifier",
    "summarizer v3",
    "router agent",
    "json-extractor",
    "tone-rewriter",
    "sql-generator",
]

// A fixed, deterministic mock dataset — stands in for the paginated fetcher result.
const makeRows = (count: number): EvalRow[] =>
    Array.from({length: count}, (_, i) => {
        const status = (["success", "error", "running", "pending"] as const)[i % 4]
        return {
            key: `row-${i}`,
            name: `${NAMES[i % NAMES.length]} #${i + 1}`,
            status,
            score: Math.round((0.5 + ((i * 37) % 50) / 100) * 100) / 100,
            latencyMs: 120 + ((i * 53) % 900),
            createdBy: ["Ada", "Linus", "Grace", "Alan"][i % 4],
            createdAt: `2026-07-${String((i % 27) + 1).padStart(2, "0")} 1${i % 9}:04`,
        }
    })

const MOCK_ROWS = makeRows(60)

const columns: ColumnsType<EvalRow> = [
    {title: "Run name", dataIndex: "name", key: "name", width: 260, fixed: "left"},
    {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 130,
        render: (status: EvalRow["status"]) => (
            <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
        ),
    },
    {
        title: "Score",
        dataIndex: "score",
        key: "score",
        width: 100,
        align: "right",
        render: (score: number) => score.toFixed(2),
    },
    {
        title: "Latency",
        dataIndex: "latencyMs",
        key: "latencyMs",
        width: 120,
        align: "right",
        render: (ms: number) => `${ms} ms`,
    },
    {title: "Created by", dataIndex: "createdBy", key: "createdBy", width: 140},
    {title: "Created at", dataIndex: "createdAt", key: "createdAt", width: 160},
]

const meta = {
    title: "@agenta/ui/Domain/InfiniteVirtualTable",
    component: InfiniteVirtualTable,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The @agenta/ui virtualized data grid engine (`@agenta/ui/table`). Fed a fixed in-memory `dataSource` + `columns` with a no-op `loadMore`, so the presentational grid renders in isolation off mocked data — no store, fetchers, or pagination.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const MockedTable = () => {
    const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
    // loadMore is required by the contract; there is nothing to load here.
    const loadMore = useCallback(() => {}, [])

    return (
        <div className="p-6">
            <div className="mb-3 text-xs text-colorTextSecondary">
                Mocked read-only grid · {MOCK_ROWS.length} rows · no live fetching
            </div>
            <div className="h-[480px] w-full border border-colorBorderSecondary rounded-md overflow-hidden">
                <InfiniteVirtualTable<EvalRow>
                    columns={columns}
                    dataSource={MOCK_ROWS}
                    loadMore={loadMore}
                    rowKey="key"
                    bodyHeight={440}
                    resizableColumns
                    rowSelection={{
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => setSelectedKeys(keys),
                    }}
                    tableProps={{scroll: {x: 900}}}
                />
            </div>
        </div>
    )
}

const EmptyTable = () => {
    const loadMore = useCallback(() => {}, [])
    return (
        <div className="p-6">
            <div className="h-[280px] w-full border border-colorBorderSecondary rounded-md overflow-hidden">
                <InfiniteVirtualTable<EvalRow>
                    columns={columns}
                    dataSource={[]}
                    loadMore={loadMore}
                    rowKey="key"
                    bodyHeight={240}
                    tableProps={{scroll: {x: 900}}}
                />
            </div>
        </div>
    )
}

/**
 * Read-only render with a mocked data source: 60 fixed rows, plain antd column defs,
 * and a no-op `loadMore`. Resizable columns + row selection are enabled to show the
 * grid features work purely off props, with no store or network.
 */
export const MockedDataSource: Story = {
    render: () => <MockedTable />,
}

/**
 * Empty state — the same component with an empty mocked data source.
 */
export const EmptyDataSource: Story = {
    render: () => <EmptyTable />,
}
