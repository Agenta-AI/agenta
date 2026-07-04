"use client"

import {useState} from "react"

import {
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnDef,
    type Row,
    type RowSelectionState,
    type SortingState,
} from "@tanstack/react-table"

import {cn} from "@agenta/primitive-ui/lib/utils"

import {Button} from "./button"
import {Spinner} from "./spinner"
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "./table"

/**
 * Headless TanStack Table + shadcn markup.
 * The shared migration target for antd <Table>; per-screen conversions map
 * antd `columns` to ColumnDef and pass rows through unchanged.
 */

export interface DataTableProps<TData> {
    columns: ColumnDef<TData, unknown>[]
    data: TData[]
    loading?: boolean
    enableSorting?: boolean
    rowSelection?: boolean
    getRowId?: (row: TData, index: number) => string
    onRowClick?: (row: Row<TData>) => void
    emptyText?: React.ReactNode
    className?: string
    /** Client-side pagination; omit to render all rows. */
    pageSize?: number
    /** Reserved: virtualized rendering lands with the large-table migrations. */
    virtualized?: boolean
}

export function DataTable<TData>({
    columns,
    data,
    loading = false,
    enableSorting = true,
    rowSelection = false,
    getRowId,
    onRowClick,
    emptyText = "No data",
    className,
    pageSize,
}: DataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>([])
    const [selection, setSelection] = useState<RowSelectionState>({})

    const table = useReactTable({
        data,
        columns,
        getRowId,
        state: {sorting, rowSelection: selection},
        onSortingChange: setSorting,
        onRowSelectionChange: setSelection,
        enableRowSelection: rowSelection,
        enableSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
        getPaginationRowModel: pageSize ? getPaginationRowModel() : undefined,
        initialState: pageSize ? {pagination: {pageSize}} : undefined,
    })

    return (
        <div data-slot="data-table" className={cn("relative w-full overflow-auto", className)}>
            <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                const canSort = header.column.getCanSort()
                                return (
                                    <TableHead
                                        key={header.id}
                                        onClick={
                                            canSort
                                                ? header.column.getToggleSortingHandler()
                                                : undefined
                                        }
                                        className={cn(canSort && "cursor-pointer select-none")}
                                        aria-sort={
                                            header.column.getIsSorted() === "asc"
                                                ? "ascending"
                                                : header.column.getIsSorted() === "desc"
                                                  ? "descending"
                                                  : undefined
                                        }
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext(),
                                              )}
                                        {header.column.getIsSorted() === "asc" && " ↑"}
                                        {header.column.getIsSorted() === "desc" && " ↓"}
                                    </TableHead>
                                )
                            })}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                <Spinner className="mx-auto" />
                            </TableCell>
                        </TableRow>
                    ) : table.getRowModel().rows.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                data-state={row.getIsSelected() ? "selected" : undefined}
                                onClick={onRowClick ? () => onRowClick(row) : undefined}
                                className={cn(onRowClick && "cursor-pointer")}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell
                                colSpan={columns.length}
                                className="h-24 text-center text-muted-foreground"
                            >
                                {emptyText}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
            {pageSize && table.getPageCount() > 1 && (
                <div className="flex items-center justify-end gap-2 py-2">
                    <span className="text-xs text-muted-foreground">
                        Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!table.getCanPreviousPage()}
                        onClick={() => table.previousPage()}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!table.getCanNextPage()}
                        onClick={() => table.nextPage()}
                    >
                        Next
                    </Button>
                </div>
            )}
        </div>
    )
}

export type {ColumnDef, Row, SortingState}
