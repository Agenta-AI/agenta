/**
 * Atom plumbing for PlaygroundConfigSection: the per-id atom memo/stability
 * wrappers, the parameter-vs-sibling update router, and the module-level
 * `schemaAtPath` atom cache. The caches are module singletons on purpose.
 */

import {getSchemaAtPath as getSchemaAtPathUtil} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import type {DataPath} from "@agenta/shared/utils"
import type {Atom} from "jotai"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {
    isEntitySchema,
    mergeSiblingFields,
    pathTargetsSibling,
    siblingSchemaAtPath,
} from "./schemaData"

/** Memoize atom factories to return the same atom instance for the same key */
export function memoAtom<T>(factory: (id: string) => Atom<T>): (id: string) => Atom<T> {
    const cache = new Map<string, Atom<T>>()
    return (id: string) => {
        let v = cache.get(id)
        if (!v) {
            v = factory(id)
            cache.set(id, v)
        }
        return v
    }
}

/** Content-stable wrapper: keep the previous value when a recompute yields equal content. */
export function stableAtom<T>(base: Atom<T>, equals: (a: T, b: T) => boolean): Atom<T> {
    return selectAtom(base, (v) => v, equals)
}

// Route tagged `__siblingData` payloads to `actions.update`; otherwise treat as parameter updates.
export const configUpdateRouterAtom = atom(
    null,
    (_get, set, id: string, changes: Record<string, unknown>) => {
        const siblingData = (changes as {__siblingData?: Record<string, unknown>}).__siblingData
        if (siblingData) {
            set(workflowMolecule.actions.update, id, {data: siblingData} as Partial<Workflow>)
            return
        }
        set(workflowMolecule.actions.updateConfiguration, id, changes)
    },
)

/** Wrap schemaAtPath to work with the adapter's (id, path) → atom interface */
const moleculeSchemaAtPathCache = new Map<string, Atom<unknown>>()
export function moleculeSchemaAtPath(params: {
    id: string
    path: (string | number)[]
}): Atom<unknown> {
    const key = `${params.id}:${params.path.join(".")}`
    let cached = moleculeSchemaAtPathCache.get(key)
    if (!cached) {
        cached = atom((get) => {
            const full = get(workflowMolecule.selectors.resolvedData(params.id))
            const adapterData = mergeSiblingFields(null, full)
            if (pathTargetsSibling(params.path as DataPath, adapterData)) {
                return siblingSchemaAtPath(params.path)
            }
            const schema = get(workflowMolecule.selectors.parametersSchema(params.id))
            if (!isEntitySchema(schema)) return null
            return getSchemaAtPathUtil(schema, params.path) ?? null
        })
        moleculeSchemaAtPathCache.set(key, cached)
    }
    return cached
}
