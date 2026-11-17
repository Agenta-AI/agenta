import {useMemo, useState} from "react"

import {WorkflowKindTag, WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {FormattedDate, LoadError} from "@agenta/ui/components/presentational"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {
    Input,
    RadioGroup,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {ChatDotsIcon, NoteIcon} from "@phosphor-icons/react"

import {toDraftApp, useEvaluableApps} from "./appList"
import {APP_TYPE_FILTERS, filterApps, type AppTypeFilter} from "./appTypeFilter"
import type {DraftApp} from "./newEvaluationDraft"
import {PickCell} from "./PickCell"
import {SectionHint} from "./SectionHint"
import {useAppTypes} from "./useAppTypes"

const PICK: ListTableColumn = {key: "pick", label: "Select", srOnly: true, width: "20px"}
const NAME: ListTableColumn = {key: "name", label: "Name", width: "minmax(160px,2fr)"}
const TYPE: ListTableColumn = {key: "type", label: "Type", width: "minmax(100px,1fr)"}
const WIDE_COLUMNS = [
    PICK,
    NAME,
    {key: "kind", label: "Kind", width: "minmax(70px,1fr)"},
    TYPE,
    {key: "created", label: "Created At", width: "minmax(150px,1fr)"},
]
const NARROW_COLUMNS = [PICK, {...NAME, width: "minmax(120px,2fr)"}, TYPE]

/** Tailwind's `sm`. Below it the table keeps the name and the type. */
const WIDE_QUERY = "(min-width: 640px)"

/** Pick the app to evaluate: a table of the project's apps with a type filter and a search. */
export const AppSection = ({
    selectedId,
    locked,
    disabled,
    onPick,
}: {
    selectedId: string | null
    /** The page is scoped to an app, so the pick cannot change. */
    locked?: boolean
    disabled?: boolean
    onPick: (app: DraftApp) => void
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const {apps, isPending, isError, refetch} = useEvaluableApps()
    const types = useAppTypes(useMemo(() => apps.map((app) => app.id), [apps]))
    const [search, setSearch] = useState("")
    const [typeFilter, setTypeFilter] = useState<AppTypeFilter>("all")
    const shown = useMemo(
        () => filterApps(apps, types, search, typeFilter),
        [apps, types, search, typeFilter],
    )
    const groups = useMemo(() => [{key: "all", label: null, rows: shown}], [shown])
    const inert = disabled || locked

    if (isError) {
        return <LoadError title="Could not load apps" onRetry={() => void refetch()} />
    }

    const pick = (id: string) => {
        const app = apps.find((item) => item.id === id)
        if (app && !inert) onPick(toDraftApp(app))
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
                {locked ? null : (
                    <Select
                        value={typeFilter}
                        onValueChange={(value) => setTypeFilter(value as AppTypeFilter)}
                        disabled={disabled}
                    >
                        <SelectTrigger aria-label="Filter by type" className="w-[160px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {APP_TYPE_FILTERS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <Input
                    value={search}
                    placeholder="Search"
                    aria-label="Search applications"
                    disabled={disabled}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full sm:w-[260px]"
                />
            </div>
            <RadioGroup
                value={selectedId ?? ""}
                onValueChange={pick}
                disabled={inert}
                aria-label="Applications"
                className="block"
            >
                <ListTable
                    columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
                    minWidth={narrow ? 280 : 620}
                    loading={isPending}
                    groups={groups}
                    rowKey={(app) => app.id}
                    onOpenRow={inert ? undefined : (app) => pick(app.id)}
                    empty={<SectionHint>No applications available</SectionHint>}
                    renderRow={(app) => {
                        const name = app.name || app.slug || app.id
                        const type = types.get(app.id) ?? null
                        const Icon = type === "chat" ? ChatDotsIcon : NoteIcon
                        return (
                            <>
                                <PickCell
                                    mode="single"
                                    value={app.id}
                                    checked={app.id === selectedId}
                                    label={`Select ${name}`}
                                    disabled={inert}
                                    onToggle={() => pick(app.id)}
                                />
                                <span className="flex min-w-0 items-center gap-2">
                                    <Icon size={16} className="shrink-0 text-muted-foreground" />
                                    <span
                                        className="truncate text-[14px] font-medium text-foreground"
                                        title={name}
                                    >
                                        {name}
                                    </span>
                                </span>
                                {narrow ? null : (
                                    <span className="flex min-w-0">
                                        <WorkflowKindTag isEvaluator={false} />
                                    </span>
                                )}
                                <span className="flex min-w-0">
                                    <WorkflowTypeTag isEvaluator={false} workflowType={type} />
                                </span>
                                {narrow ? null : (
                                    <span className="block truncate text-[13px] text-muted-foreground">
                                        <FormattedDate date={app.created_at} fallback="—" />
                                    </span>
                                )}
                            </>
                        )
                    }}
                />
            </RadioGroup>
            {selectedId || locked ? null : (
                <p className="m-0 text-sm text-muted-foreground">
                    Please select an application to continue configuring the evaluation.
                </p>
            )}
        </div>
    )
}
