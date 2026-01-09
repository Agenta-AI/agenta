import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

// Generic test result shape used by Playground UIs
export interface PlaygroundTestResult {
    response?: any
    error?: string
    metadata?: any
}

// Per (rowId, revisionId) response store for both completion and chat
// Key format: `${rowId}:${revisionId}` to ensure stable identity across callers
type RowRevisionKey = string | {rowId: string; revisionId: string}

// Internal, string-keyed family to ensure stable caching
const responseByRowRevisionAtomByKey = atomFamily((key: string) =>
    atom<PlaygroundTestResult | PlaygroundTestResult[] | null>(null),
)

// Public family: accepts either string key or {rowId, revisionId}
export const responseByRowRevisionAtomFamily = ((param: RowRevisionKey) => {
    const key = typeof param === "string" ? param : `${param.rowId}:${param.revisionId}`
    return responseByRowRevisionAtomByKey(key)
}) as (param: RowRevisionKey) => ReturnType<typeof responseByRowRevisionAtomByKey>

// Per (rowId, revisionId) loading state (true while a run is in-flight)
// Internal, string-keyed family to ensure stable caching
const loadingByRowRevisionAtomByKey = atomFamily((key: string) => atom<boolean>(false))

// Public family: accepts either string key or {rowId, revisionId}
export const loadingByRowRevisionAtomFamily = ((param: RowRevisionKey) => {
    const key = typeof param === "string" ? param : `${param.rowId}:${param.revisionId}`
    return loadingByRowRevisionAtomByKey(key)
}) as (param: RowRevisionKey) => ReturnType<typeof loadingByRowRevisionAtomByKey>
