import type {Key, ReactNode} from "react"
import {useCallback, useMemo} from "react"

import type {OnChangeFn, RowSelectionState} from "@tanstack/react-table"

import {Checkbox} from "../../components/ui/checkbox"
import {RadioGroup, RadioGroupItem} from "../../components/ui/radio-group"
import type {InfiniteVirtualTableRowSelection} from "../types"

/**
 * Translates antd's `rowSelection` into the props `VirtualTable` speaks.
 *
 * antd owns selection internally and hands you callbacks; TanStack keeps it in a
 * `Record<rowId, boolean>` that the host controls. The shapes are the same information,
 * so this converts between them rather than asking ~80 call sites to change.
 *
 * `VirtualTable.getRowId` stringifies `rowKey`, so a `RowSelectionState` key IS
 * `String(rowKey(record))` — that identity is what makes the mapping exact.
 */

export interface VirtualTableRowSelectionProps<RecordType extends object> {
    rowSelection: RowSelectionState
    onRowSelectionChange: OnChangeFn<RowSelectionState>
    leadingColumnWidth: number
    renderLeadingCell: (record: RecordType, index: number) => ReactNode
    renderLeadingHeader: () => ReactNode
    /** Set only when `selectOnRowClick` is on; compose it into the host's `onRow`. */
    onRowClickSelect?: (record: RecordType, index: number) => void
}

const useVirtualTableRowSelection = <RecordType extends object>({
    rowSelection,
    dataSource,
    rowKey,
}: {
    rowSelection: InfiniteVirtualTableRowSelection<RecordType> | undefined
    dataSource: RecordType[]
    rowKey: (record: RecordType, index: number) => Key
}): VirtualTableRowSelectionProps<RecordType> | undefined => {
    const {
        selectedRowKeys,
        onChange,
        getCheckboxProps,
        columnWidth = 48,
        type = "checkbox",
        columnTitle,
        renderCell,
        selectOnRowClick,
    } = rowSelection ?? {}

    const isRadio = type === "radio"

    // Row ids are strings in TanStack; antd keys are string | number.
    const selectionState = useMemo<RowSelectionState>(() => {
        const state: RowSelectionState = {}
        for (const key of selectedRowKeys ?? []) state[String(key)] = true
        return state
    }, [selectedRowKeys])

    // Lets us hand `onChange` the records for the keys it reports, and skip disabled rows.
    const {recordById, disabledIds, keyById} = useMemo(() => {
        const byId = new Map<string, RecordType>()
        // Object.keys() is always strings; antd keys may be numbers, so map back on the way out.
        const keys = new Map<string, Key>()
        const disabled = new Set<string>()
        dataSource.forEach((record, index) => {
            const id = String(rowKey(record, index))
            byId.set(id, record)
            keys.set(id, rowKey(record, index))
            if (getCheckboxProps?.(record).disabled) disabled.add(id)
        })
        return {recordById: byId, disabledIds: disabled, keyById: keys}
    }, [dataSource, rowKey, getCheckboxProps])

    const emit = useCallback(
        (next: RowSelectionState) => {
            const ids = Object.keys(next).filter((id) => next[id])
            const keys: Key[] = ids.map((id) => keyById.get(id) ?? id)
            // Keys can outlive their rows across pages; only map back the ones we hold.
            const rows = ids
                .map((id) => recordById.get(id))
                .filter((record): record is RecordType => record !== undefined)
            onChange?.(keys, rows)
        },
        [onChange, recordById, keyById],
    )

    const onRowSelectionChange = useCallback<OnChangeFn<RowSelectionState>>(
        (updaterOrValue) => {
            const next =
                typeof updaterOrValue === "function"
                    ? updaterOrValue(selectionState)
                    : updaterOrValue

            // A disabled row must never enter the set, however it got there.
            const allowed: RowSelectionState = {}
            for (const [id, selected] of Object.entries(next)) {
                if (selected && !disabledIds.has(id)) allowed[id] = true
            }

            if (!isRadio) {
                emit(allowed)
                return
            }

            // Radio keeps exactly one: whichever id is newly on, else the survivor.
            const added = Object.keys(allowed).find((id) => !selectionState[id])
            const only = added ?? Object.keys(allowed)[0]
            emit(only ? {[only]: true} : {})
        },
        [selectionState, disabledIds, isRadio, emit],
    )

    const toggle = useCallback(
        (id: string, selected: boolean) => {
            if (disabledIds.has(id)) return
            if (isRadio) {
                emit(selected ? {[id]: true} : {})
                return
            }
            const next = {...selectionState}
            if (selected) next[id] = true
            else delete next[id]
            emit(next)
        },
        [selectionState, disabledIds, isRadio, emit],
    )

    const selectableIds = useMemo(
        () => [...recordById.keys()].filter((id) => !disabledIds.has(id)),
        [recordById, disabledIds],
    )

    const selectedCount = selectableIds.filter((id) => selectionState[id]).length
    const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length
    const someSelected = selectedCount > 0 && !allSelected

    const renderLeadingHeader = useCallback((): ReactNode => {
        if (columnTitle !== undefined) return columnTitle
        // Radio has no "select all" in antd either.
        if (isRadio) return null
        return (
            <Checkbox
                aria-label="Select all rows"
                checked={someSelected ? "indeterminate" : allSelected}
                disabled={selectableIds.length === 0}
                onCheckedChange={(checked) => {
                    if (checked === true) {
                        emit(Object.fromEntries(selectableIds.map((id) => [id, true])))
                    } else {
                        emit({})
                    }
                }}
            />
        )
    }, [columnTitle, isRadio, someSelected, allSelected, selectableIds, emit])

    const renderLeadingCell = useCallback(
        (record: RecordType, index: number): ReactNode => {
            const id = String(rowKey(record, index))
            const checked = Boolean(selectionState[id])
            const props = getCheckboxProps?.(record) ?? {}

            // A Radix radio item needs a RadioGroup ancestor, and the group can't span rows
            // here (each cell renders independently), so each row owns a one-item group and
            // exclusivity comes from our state instead.
            const originNode = isRadio ? (
                <RadioGroup
                    value={checked ? id : ""}
                    onValueChange={() => toggle(id, true)}
                    disabled={props.disabled}
                >
                    <RadioGroupItem aria-label={`Select row ${id}`} value={id} />
                </RadioGroup>
            ) : (
                <Checkbox
                    aria-label={`Select row ${id}`}
                    checked={props.indeterminate && !checked ? "indeterminate" : checked}
                    disabled={props.disabled}
                    onCheckedChange={(next) => toggle(id, next === true)}
                />
            )

            return renderCell ? renderCell(checked, record, index, originNode) : originNode
        },
        [rowKey, selectionState, getCheckboxProps, isRadio, toggle, renderCell],
    )

    const onRowClickSelect = useCallback(
        (record: RecordType, index: number) => {
            const id = String(rowKey(record, index))
            toggle(id, !selectionState[id])
        },
        [rowKey, selectionState, toggle],
    )

    return useMemo(() => {
        if (!rowSelection) return undefined
        return {
            rowSelection: selectionState,
            onRowSelectionChange,
            leadingColumnWidth: columnWidth,
            renderLeadingCell,
            renderLeadingHeader,
            ...(selectOnRowClick ? {onRowClickSelect} : {}),
        }
    }, [
        rowSelection,
        selectionState,
        onRowSelectionChange,
        columnWidth,
        renderLeadingCell,
        renderLeadingHeader,
        selectOnRowClick,
        onRowClickSelect,
    ])
}

export default useVirtualTableRowSelection
