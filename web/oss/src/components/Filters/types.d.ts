import type {
    ColumnGroup,
    ColumnOption,
    CustomValueType,
    FilterGroup,
    FilterItem,
    FilterLeaf,
    FilterMenuNode,
    IconSlot,
    InputConfig,
    RowValidation,
    SelectOption,
} from "@agenta/observability"

// The filter-menu model belongs to the observability filter engine; re-exported
// here (type-only, so nothing lands in the bundle) for the app's existing callers.
export type {
    ColumnGroup,
    ColumnOption,
    CustomValueType,
    FilterGroup,
    FilterItem,
    FilterLeaf,
    FilterMenuNode,
    InputConfig,
    RowValidation,
    SelectOption,
}

export type IconType = IconSlot

export interface Props {
    filterData?: Filter[]
    columns: FilterMenuNode[]
    onApplyFilter: (filters: Filter[]) => void
    onClearFilter: (filters: Filter[]) => void
    buttonProps?: ButtonProps
    /**
     * Optional callback to derive a *display-only* view of the local filter
     * state. Called whenever the user changes a row in the dialog. The dialog
     * renders from the returned array, but mutations still target the
     * underlying `filter` state by index, so the reconciler MUST preserve
     * array length and per-index order.
     */
    reconcileFilterRows?: (rows: FilterItem[]) => FilterItem[]
}

export type FieldMenuItem = Required<MenuProps>["items"][number]
