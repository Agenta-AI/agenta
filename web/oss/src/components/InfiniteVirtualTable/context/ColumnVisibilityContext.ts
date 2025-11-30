import {createContext, useContext} from "react"
import type {Key} from "react"

import type {VisibilityRegistrationHandler} from "../components/ColumnVisibilityHeader"
import type {ColumnVisibilityState, ColumnVisibilityMenuRenderer} from "../types"

const noop = () => undefined

const defaultColumnVisibilityControls: ColumnVisibilityState<any> = {
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

export interface ColumnVisibilityContextValue<RecordType extends object = any> {
    controls: ColumnVisibilityState<RecordType>
    registerHeader: VisibilityRegistrationHandler | null
    version: number
    renderMenuContent?: ColumnVisibilityMenuRenderer<RecordType>
    scopeId: string | null
}

export const defaultColumnVisibilityContextValue: ColumnVisibilityContextValue = {
    controls: defaultColumnVisibilityControls,
    registerHeader: null,
    version: 0,
    renderMenuContent: undefined,
    scopeId: null,
}

const ColumnVisibilityContext = createContext<ColumnVisibilityContextValue>(
    defaultColumnVisibilityContextValue,
)

export const useColumnVisibilityContext = <RecordType extends object = any>() =>
    useContext(ColumnVisibilityContext) as ColumnVisibilityContextValue<RecordType>

export const useColumnVisibilityControls = <RecordType extends object = any>() =>
    useColumnVisibilityContext<RecordType>().controls

export {defaultColumnVisibilityControls}

export default ColumnVisibilityContext
