import {useT} from "@agenta/i18n"
import addToTestsetCatalog from "@agenta/i18n/catalogs/observability.addToTestset"
import {Alert, Button, cn, Combobox, Input, SkeletonBlock} from "@agenta/ui/ui"
import {ArrowRightIcon, PlusIcon, TrashIcon} from "@phosphor-icons/react"

import {CREATE_NEW, type ColumnsStatus, type MappingRow} from "./useAddToTestsetForm"

/**
 * Step 2: one row per mapping, a span data path to a test set column. A new test set has no
 * columns yet, so each row names its column. An existing one offers its columns, or a new name.
 */
export const MappingRows = ({
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
    const t = useT(addToTestsetCatalog)
    const hasDuplicates = duplicates.length > 0
    const paths = pathOptions.map((path) => ({value: path, label: path, searchValue: path}))

    const body = () => {
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
                    message={t("observability.addToTestset.couldNotLoadColumns")}
                    action={
                        <Button variant="outline" size="sm" onClick={onRetryColumns}>
                            {t("observability.addToTestset.tryAgain")}
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
                        {
                            value: CREATE_NEW,
                            label: t("observability.addToTestset.createNew"),
                            searchValue: t("observability.addToTestset.createNew"),
                        },
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
                                aria-label={t("observability.addToTestset.dataPath", {
                                    index: index + 1,
                                })}
                                className="min-w-0 sm:flex-1"
                                options={paths}
                                value={row.path || undefined}
                                onChange={(path) => onEdit(row.id, {path: path ?? ""})}
                                placeholder={t("observability.addToTestset.selectDataPath")}
                            />
                            <ArrowRightIcon
                                size={16}
                                className="text-muted-foreground hidden shrink-0 self-center sm:block"
                                aria-hidden
                            />
                            <div className="flex min-w-0 flex-col gap-1 sm:flex-1">
                                {isNewTestset ? null : (
                                    <Combobox
                                        aria-label={t("observability.addToTestset.columnN", {
                                            index: index + 1,
                                        })}
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
                                        placeholder={t("observability.addToTestset.selectColumn")}
                                    />
                                )}
                                {showsName ? (
                                    <Input
                                        aria-label={t("observability.addToTestset.columnNameN", {
                                            index: index + 1,
                                        })}
                                        placeholder={t("observability.addToTestset.columnName")}
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
                                aria-label={t("observability.addToTestset.removeMapping", {
                                    index: index + 1,
                                })}
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
                    {t("observability.addToTestset.addField")}
                </Button>
            </>
        )
    }

    return (
        <section className="flex flex-col gap-2">
            <div>
                <h3 className={cn("m-0 text-sm font-medium", hasDuplicates && "text-destructive")}>
                    {t("observability.addToTestset.step2Title")}
                </h3>
                <p
                    className={cn(
                        "m-0 text-xs",
                        hasDuplicates ? "text-destructive" : "text-muted-foreground",
                    )}
                >
                    {hasDuplicates
                        ? t("observability.addToTestset.duplicateColumns")
                        : mappings.length > 0
                          ? t("observability.addToTestset.mappingsShown")
                          : t("observability.addToTestset.addMappingHint")}
                </p>
            </div>
            {body()}
        </section>
    )
}
