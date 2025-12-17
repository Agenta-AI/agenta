import type {ReactNode} from "react"
import {useRef} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Provider} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {createStore} from "jotai/vanilla"
import type {Store} from "jotai/vanilla/store"
import {queryClientAtom} from "jotai-tanstack-query"

export const InfiniteVirtualTableStoreHydrator = ({
    queryClient,
    children,
}: {
    queryClient: ReturnType<typeof useQueryClient>
    children: ReactNode
}) => {
    useHydrateAtoms([[queryClientAtom, queryClient]])
    return <>{children}</>
}

export const InfiniteVirtualTableStoreProvider = ({
    store,
    children,
}: {
    store?: Store
    children: ReactNode
}) => {
    const queryClient = useQueryClient()
    const storeRef = useRef<Store>(store ?? createStore())
    return (
        <Provider store={storeRef.current}>
            <InfiniteVirtualTableStoreHydrator queryClient={queryClient}>
                {children}
            </InfiniteVirtualTableStoreHydrator>
        </Provider>
    )
}
