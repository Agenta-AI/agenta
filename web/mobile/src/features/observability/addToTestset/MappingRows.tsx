import {Alert, Button, cn, Combobox, Input, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowRightIcon, PlusIcon, TrashIcon} from "@phosphor-icons/react"

import {CREATE_NEW, type ColumnsStatus, type MappingRow} from "./useAddToTestsetForm"

/**
 * Step 2: one row per mapping, a span data path to a test set column. A new test set has no
 * columns yet, so each row names its column. An existing one offers its columns, or a new name.
 */
export const MappingRows = ({
    hasTarget,
    isNewTestset,
    columnsStatus,
    columns,
    onRetryColumns,
    pathOptions,
    mappings,
    duplicates,
    onEdit,
    onAdd,
    onRemove,
}: {
    hasTarget: boolean
    isNewTestset: boolean
    columnsStatus: ColumnsStatus
    columns: readonly string[]
    onRetryColumns: () => void
    pathOptions: readonly string[]
    mappings: readonly MappingRow[]
    duplicates: readonly string[]
    onEdit: (id: string, patch: Partial<Omit<MappingRow, "id">>) => void
    onAdd: () => void
    onRemove: (id: string) => void
}) => {
    const hasDuplicates = duplicates.length > 0
    const paths = pathOptions.map((path) => ({value: path, label: path, searchValue: path}))

    const body = () => {
        if (!hasTarget) {
            return (
                <p className="text-muted-foreground m-0 text-sm">
                    Select a test set above to start mapping fields
                </p>
            )
        }
        if (columnsStatus === "loading") {
            return (
                <div className="flex flex-col gap-2" aria-busy="true">
                    <SkeletonBlock className="h-8 w-full" />
                    <SkeletonBlock className="h-8 w-full" />
                </div>
            )
        }
        if (columnsStatus === "error") {
            return (
                <Alert
                    type="error"
                    showIcon
                    message="Couldn't load the test set columns"
                    action={
                        <Button variant="outline" size="sm" onClick={onRetryColumns}>
                            Try again
                        </Button>
                    }
                />
            )
        }
        return (
            <>
                {mappings.map((row, index) => {
                    // A column another row already maps to is not offered again.
                    const taken = new Set(
                        mappings
                            .filter((other) => other.id !== row.id)
                            .map((other) => other.column),
                    )
                    const columnOptions = [
                        {value: CREATE_NEW, label: "Create New", searchValue: "Create New"},
                        ...columns
                            .filter((column) => !taken.has(column))
                            .map((column) => ({value: column, label: column, searchValue: column})),
                    ]
                    const showsName = isNewTestset || row.isNewColumn
                    return (
                        <div
                            key={row.id}
                            className="flex flex-col gap-2 sm:flex-row sm:items-start"
                            data-testid="mapping-row"
                        >
                            <Combobox
                                aria-label={`Data path ${index + 1}`}
                                className="min-w-0 sm:flex-1"
                                options={paths}
                                value={row.path || undefined}
                                onChange={(path) => onEdit(row.id, {path: path ?? ""})}
                                placeholder="Select a data path"
                            />
                            <ArrowRightIcon
                                size={16}
                                className="text-muted-foreground hidden shrink-0 self-center sm:block"
                                aria-hidden
                            />
                            <div className="flex min-w-0 flex-col gap-1 sm:flex-1">
                                {isNewTestset ? null : (
                                    <Combobox
                                        aria-label={`Column ${index + 1}`}
                                        options={columnOptions}
                                        value={
                                            row.isNewColumn ? CREATE_NEW : row.column || undefined
                                        }
                                        onChange={(next) =>
                                            onEdit(
                                                row.id,
                                                next === CREATE_NEW
                                                    ? {isNewColumn: true, column: ""}
                                                    : {isNewColumn: false, column: next ?? ""},
                                            )
                                        }
                                        placeholder="Select a column"
                                    />
                                )}
                                {showsName ? (
                                    <Input
                                        aria-label={`Column name ${index + 1}`}
                                        placeholder="Column name"
                                        value={row.column}
                                        onChange={(event) =>
                                            onEdit(row.id, {column: event.target.value})
                                        }
                                    />
                                ) : null}
                            </div>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove mapping ${index + 1}`}
                                className="self-end sm:self-start"
                                onClick={() => onRemove(row.id)}
                            >
                                <TrashIcon />
                            </Button>
                        </div>
                    )
                })}
                <Button variant="outline" size="sm" className="self-start" onClick={onAdd}>
                    <PlusIcon />
                    Add field
                </Button>
            </>
        )
    }

    return (
        <section className="flex flex-col gap-2">
            <div>
                <h3 className={cn("m-0 text-sm font-medium", hasDuplicates && "text-destructive")}>
                    2. Map fields
                </h3>
                <p
                    className={cn(
                        "m-0 text-xs",
                        hasDuplicates ? "text-destructive" : "text-muted-foreground",
                    )}
                >
                    {hasDuplicates
                        ? "Duplicate columns detected. Ensure each column is unique."
                        : mappings.length > 0
                          ? "Your field mappings are shown below. You can also add mappings manually."
                          : "Add a mapping to choose what goes into each column."}
                </p>
            </div>
            {body()}
        </section>
    )
}
