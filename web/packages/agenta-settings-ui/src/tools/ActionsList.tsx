import {useMemo} from "react"

import type {ToolCatalogAction} from "@agenta/entities/gatewayTool"
import {Tag} from "@agenta/ui/components/presentational"
import {DataTable, type DataTableColumn} from "@agenta/ui/ui"

interface Props {
    actions: ToolCatalogAction[]
}

/** What an integration can actually do, listed under its detail pane. */
export default function ActionsList({actions}: Props) {
    const columns = useMemo<DataTableColumn<ToolCatalogAction>[]>(
        () => [
            {key: "name", title: "Name", width: 220, render: (record) => record.name},
            {
                key: "description",
                title: "Description",
                render: (record) => (
                    <span
                        className="block truncate text-colorTextSecondary"
                        title={record.description ?? undefined}
                    >
                        {record.description || "-"}
                    </span>
                ),
            },
            {
                key: "categories",
                title: "Categories",
                width: 220,
                render: (record) =>
                    record.categories?.length ? (
                        <div className="flex flex-wrap gap-1">
                            {record.categories.map((category) => (
                                <Tag key={category}>{category}</Tag>
                            ))}
                        </div>
                    ) : (
                        "-"
                    ),
            },
        ],
        [],
    )

    return (
        <DataTable<ToolCatalogAction>
            columns={columns}
            rows={actions}
            rowKey={(record) => record.key}
        />
    )
}
