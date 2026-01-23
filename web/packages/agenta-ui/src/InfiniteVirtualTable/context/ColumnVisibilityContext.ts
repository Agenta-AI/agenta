import {createContext, useContext} from "react"
import type {Key} from "react"

import type {VisibilityRegistrationHandler} from "../components/ColumnVisibilityHeader"
import type {
    ColumnVisibilityState,
    ColumnVisibilityMenuRenderer,
    ColumnVisibilityMenuTriggerRenderer,
    InfiniteTableRowBase,
} from "../types"

const noop = () => undefined

const defaultColumnVisibilityControls: ColumnVisibilityState<InfiniteTableRowBase> = {
    allKeys: [],
    leafKeys: [],
    hiddenKeys: [],
    setHiddenKeys: (_keys: Key[]) => undefined,
    isHidden: () => false,
    showColumn: noop,
    hideColumn: noop,
    toggleColumn: noop,
    toggleTree: noop,
    reset: noop,
    visibleColumns: [],
    columnTree: [],
    version: 0,
}

export interface ColumnVisibilityContextValue<RecordType extends object = InfiniteTableRowBase> {
    controls: ColumnVisibilityState<RecordType>
    registerHeader: VisibilityRegistrationHandler | null
    version: number
    renderMenuContent?: ColumnVisibilityMenuRenderer<RecordType>
    renderMenuTrigger?: ColumnVisibilityMenuTriggerRenderer<RecordType>
    scopeId: string | null
}

export const defaultColumnVisibilityContextValue: ColumnVisibilityContextValue = {
    controls: defaultColumnVisibilityControls,
    registerHeader: null,
    version: 0,
    renderMenuContent: undefined,
    renderMenuTrigger: undefined,
    scopeId: null,
}

const ColumnVisibilityContext = createContext<ColumnVisibilityContextValue>(
    defaultColumnVisibilityContextValue,
)

export const useColumnVisibilityContext = <
    RecordType extends object = InfiniteTableRowBase,
>(): ColumnVisibilityContextValue<RecordType> =>
    useContext(ColumnVisibilityContext) as unknown as ColumnVisibilityContextValue<RecordType>

export const useColumnVisibilityControls = <
    RecordType extends object = InfiniteTableRowBase,
>(): ColumnVisibilityState<RecordType> => useColumnVisibilityContext<RecordType>().controls

export {defaultColumnVisibilityControls}

export default ColumnVisibilityContext
