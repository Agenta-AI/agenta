import {useMemo} from "react"

import type {ToolCatalogAction} from "@agenta/entities/gatewayTool"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"

interface Props {
    actions: ToolCatalogAction[]
}

export default function ActionsList({actions}: Props) {
    const columns: ColumnDef<ToolCatalogAction, unknown>[] = useMemo(
        () => [
            {
                id: "name",
                accessorKey: "name",
                header: "Name",
                enableSorting: false,
                cell: ({row}) => <span>{row.original.name}</span>,
            },
            {
                id: "description",
                accessorKey: "description",
                header: "Description",
                enableSorting: false,
                cell: ({row}) => (
                    <span
                        className="inline-block max-w-[420px] truncate text-muted-foreground"
                        title={row.original.description || undefined}
                    >
                        {row.original.description || "-"}
                    </span>
                ),
            },
            {
                id: "categories",
                accessorKey: "categories",
                header: "Categories",
                enableSorting: false,
                cell: ({row}) => {
                    const categories = row.original.categories
                    return categories && categories.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                            {categories.map((category) => (
                                <Badge key={category} variant="outline">
                                    {category}
                                </Badge>
                            ))}
                        </div>
                    ) : (
                        <span>-</span>
                    )
                },
            },
        ],
        [],
    )

    return (
        <DataTable<ToolCatalogAction>
            columns={columns}
            data={actions}
            getRowId={(record) => record.key}
            enableSorting={false}
            pageSize={actions.length > 20 ? 20 : undefined}
        />
    )
}
