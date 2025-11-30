import {useMemo, type PropsWithChildren} from "react"

import type {VisibilityRegistrationHandler} from "../components/ColumnVisibilityHeader"
import ColumnVisibilityContext, {
    defaultColumnVisibilityContextValue,
    type ColumnVisibilityContextValue,
} from "../context/ColumnVisibilityContext"
import type {ColumnVisibilityState, ColumnVisibilityMenuRenderer} from "../types"

interface ColumnVisibilityProviderProps<RecordType extends object = any> extends PropsWithChildren {
    controls: ColumnVisibilityState<RecordType> | null
    registerHeader?: VisibilityRegistrationHandler | null
    version?: number
    renderMenuContent?: ColumnVisibilityMenuRenderer<RecordType>
    scopeId?: string | null
}

const ColumnVisibilityProvider = <RecordType extends object = any>({
    controls,
    registerHeader = null,
    version = 0,
    renderMenuContent,
    scopeId = null,
    children,
}: ColumnVisibilityProviderProps<RecordType>) => {
    const value = useMemo<ColumnVisibilityContextValue<RecordType>>(
        () => ({
            controls:
                controls ??
                (defaultColumnVisibilityContextValue.controls as ColumnVisibilityState<RecordType>),
            registerHeader,
            version,
            renderMenuContent,
            scopeId,
        }),
        [controls, registerHeader, renderMenuContent, scopeId, version],
    )

    return (
        <ColumnVisibilityContext.Provider value={value}>
            {children}
        </ColumnVisibilityContext.Provider>
    )
}

export default ColumnVisibilityProvider
