/**
 * Stateful Entity Atoms for Testset Module
 *
 * These atoms combine entity storage (cache) with query atoms (server state)
 * to provide a simple, single-atom API that handles both caching and fetching.
 *
 * Use these when you want:
 * - Automatic query triggering when entity not in cache
 * - Loading and error states
 * - Single atom subscription instead of entity + query
 *
 * Use base entity atoms when you want:
 * - Pure cache reads (no automatic fetching)
 * - Manual control over when queries run
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {QueryResult} from "../shared/createStatefulEntityAtomFamily"
import {createStatefulEntityAtomFamily} from "../shared/createStatefulEntityAtomFamily"
import {projectIdAtom} from "../../project/selectors/project"

import {revisionEntityAtomFamily, revisionQueryAtomFamily} from "./revisionEntity"
import type {Revision} from "./revisionSchema"
import {testsetStore, revisionStore, variantStore} from "./store"

/**
 * Stateful testset atom family
 *
 * Automatically fetches testset if not in cache, provides loading/error states.
 * Requires projectId to be set in context.
 *
 * @example
 * ```typescript
 * function TestsetViewer({testsetId}: {testsetId: string}) {
 *   const testsetState = useAtomValue(testsetStatefulAtomFamily(testsetId))
 *
 *   if (testsetState.isPending) return <Loading />
 *   if (testsetState.isError) return <Error error={testsetState.error} />
 *   if (!testsetState.data) return <NotFound />
 *
 *   return <div>{testsetState.data.name}</div>
 * }
 * ```
 */
export const testsetStatefulAtomFamily = createStatefulEntityAtomFamily({
    entityAtomFamily: testsetStore.entityAtomFamily,
    detailQueryAtom: testsetStore.detailQueryAtom,
    getQueryParams: (get, id) => {
        const projectId = get(projectIdAtom)
        return projectId ? {id, projectId} : null
    },
})

/**
 * Stateful revision atom family
 *
 * Wraps revisionEntityAtomFamily (which includes batch fetching + draft merging)
 * with query state for loading/error handling.
 *
 * This is a specialized wrapper because revisions have:
 * - Batch fetching at query level (revisionQueryAtomFamily)
 * - Draft state merging (revisionEntityAtomFamily)
 *
 * @example
 * ```typescript
 * function RevisionViewer({revisionId}: {revisionId: string}) {
 *   const revisionState = useAtomValue(revisionStatefulAtomFamily(revisionId))
 *
 *   if (revisionState.isPending) return <Loading />
 *   if (revisionState.isError) return <Error error={revisionState.error} />
 *   if (!revisionState.data) return <NotFound />
 *
 *   return <div>Version {revisionState.data.version}</div>
 * }
 * ```
 */
export const revisionStatefulAtomFamily = atomFamily(
    (revisionId: string) =>
        atom((get): QueryResult<Revision> => {
            // Get query state (for loading/error)
            const queryState = get(revisionQueryAtomFamily(revisionId))

            // Get entity (includes draft merged with server data)
            const entityData = get(revisionEntityAtomFamily(revisionId))

            return {
                data: entityData,
                isPending: queryState.isPending,
                isError: queryState.isError,
                error: queryState.error,
            }
        }),
    (a, b) => a === b,
)

/**
 * Stateful variant atom family
 *
 * Automatically fetches variant if not in cache, provides loading/error states.
 * Variants contain the name and description.
 */
export const variantStatefulAtomFamily = createStatefulEntityAtomFamily({
    entityAtomFamily: variantStore.entityAtomFamily,
    detailQueryAtom: variantStore.detailQueryAtom,
    getQueryParams: (get, id) => {
        const projectId = get(projectIdAtom)
        return projectId ? {id, projectId} : null
    },
})
