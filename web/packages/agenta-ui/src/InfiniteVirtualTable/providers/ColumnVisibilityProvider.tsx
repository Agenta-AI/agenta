import {useMemo, type PropsWithChildren} from "react"

import type {VisibilityRegistrationHandler} from "../components/ColumnVisibilityHeader"
import ColumnVisibilityContext, {
    defaultColumnVisibilityContextValue,
    type ColumnVisibilityContextValue,
} from "../context/ColumnVisibilityContext"
import type {
    ColumnVisibilityState,
    ColumnVisibilityMenuRenderer,
    ColumnVisibilityMenuTriggerRenderer,
} from "../types"

interface ColumnVisibilityProviderProps<
    RecordType extends object = object,
> extends PropsWithChildren {
    controls: ColumnVisibilityState<RecordType> | null
    registerHeader?: VisibilityRegistrationHandler | null
    version?: number
    renderMenuContent?: ColumnVisibilityMenuRenderer<RecordType>
    renderMenuTrigger?: ColumnVisibilityMenuTriggerRenderer<RecordType>
    scopeId?: string | null
}

const ColumnVisibilityProvider = <RecordType extends object = object>({
    controls,
    registerHeader = null,
    version = 0,
    renderMenuContent,
    renderMenuTrigger,
    scopeId = null,
    children,
}: ColumnVisibilityProviderProps<RecordType>) => {
    // Generic context pattern: Double cast needed because React Context doesn't support generics.
    // The context is created with base type (InfiniteTableRowBase) but consumed with specific RecordType.
    const value = useMemo<ColumnVisibilityContextValue<RecordType>>(
        () => ({
            controls:
                controls ??
                (defaultColumnVisibilityContextValue.controls as unknown as ColumnVisibilityState<RecordType>),
            registerHeader,
            version,
            renderMenuContent,
            renderMenuTrigger,
            scopeId,
        }),
        [controls, registerHeader, renderMenuContent, renderMenuTrigger, scopeId, version],
    )

    return (
        <ColumnVisibilityContext.Provider value={value as unknown as ColumnVisibilityContextValue}>
            {children}
        </ColumnVisibilityContext.Provider>
    )
}

export default ColumnVisibilityProvider
