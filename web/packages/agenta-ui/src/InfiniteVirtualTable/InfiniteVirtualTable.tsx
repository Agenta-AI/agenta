import {useEffect, useRef} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Provider} from "jotai"
import {createStore} from "jotai/vanilla"
import type {Store} from "jotai/vanilla/store"

import InfiniteVirtualTableInner from "./components/InfiniteVirtualTableInner"
import {useColumnVisibilityControls as useColumnVisibilityControlsFromContext} from "./context/ColumnVisibilityContext"
import {useVirtualTableScrollContainer} from "./context/VirtualTableScrollContainerContext"
import {
    InfiniteVirtualTableStoreHydrator,
    InfiniteVirtualTableStoreProvider,
} from "./providers/InfiniteVirtualTableStoreProvider"
import type {
    ColumnVisibilityConfig,
    ColumnVisibilityState,
    InfiniteVirtualTableProps,
    InfiniteVirtualTableRowSelection,
    ResizableColumnsConfig,
} from "./types"

export {useVirtualTableScrollContainer}

export const useColumnVisibilityControls = <RecordType extends object>() =>
    useColumnVisibilityControlsFromContext<RecordType>()

function InfiniteVirtualTable<RecordType extends object>(
    props: InfiniteVirtualTableProps<RecordType>,
) {
    const {useIsolatedStore = false, store, ...rest} = props
    const queryClient = useQueryClient()
    const managedStoreRef = useRef<Store | null>(store ?? null)

    useEffect(() => {
        if (store) {
            managedStoreRef.current = store
        }
    }, [store])

    if (!store && useIsolatedStore && !managedStoreRef.current) {
        managedStoreRef.current = createStore()
    }

    const activeStore = managedStoreRef.current
    const content = <InfiniteVirtualTableInner {...rest} />

    if (!activeStore) {
        return content
    }

    return (
        <Provider store={activeStore}>
            <InfiniteVirtualTableStoreHydrator queryClient={queryClient}>
                {content}
            </InfiniteVirtualTableStoreHydrator>
        </Provider>
    )
}

export {InfiniteVirtualTableStoreProvider}

export default InfiniteVirtualTable

export type {
    InfiniteVirtualTableRowSelection,
    ResizableColumnsConfig,
    ColumnVisibilityConfig,
    ColumnVisibilityState,
}
