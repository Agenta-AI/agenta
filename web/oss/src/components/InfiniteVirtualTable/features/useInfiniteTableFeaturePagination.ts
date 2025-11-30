import type {InfiniteDatasetStore} from "../createInfiniteDatasetStore"
import type {InfiniteTableRowBase} from "../types"
import type {TableScopeConfig, TableFeaturePagination} from "./InfiniteVirtualTableFeatureShell"

interface UseFeaturePaginationOptions {
    resetOnScopeChange?: boolean
}

const useInfiniteTableFeaturePagination = <Row extends InfiniteTableRowBase>(
    datasetStore: InfiniteDatasetStore<Row, any, any>,
    tableScope: TableScopeConfig,
    options?: UseFeaturePaginationOptions,
): TableFeaturePagination<Row> => {
    const {scopeId, pageSize} = tableScope
    return datasetStore.hooks.usePagination({
        scopeId,
        pageSize,
        resetOnScopeChange: options?.resetOnScopeChange,
    })
}

export default useInfiniteTableFeaturePagination
