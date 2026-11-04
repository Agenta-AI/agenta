import {invalidateTestsetsListCache} from "@agenta/entities/testset"
import type {QueryClient} from "@tanstack/react-query"

/** Make every test set list read again after a save. */
export function refreshTestsetLists(queryClient: QueryClient): Promise<void> {
    invalidateTestsetsListCache()
    return queryClient.invalidateQueries({queryKey: ["testsets"]})
}
