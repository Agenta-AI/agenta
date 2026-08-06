/**
 * The default `ConfigSectionMoleculeAdapter`, backed by workflowMolecule.
 * `defaultAdapter` is a module singleton — the memoized atom factories inside it
 * must be shared across every mount so the atoms stay referentially stable.
 */

import {workflowMolecule} from "@agenta/entities/workflow"
import type {DataPath} from "@agenta/shared/utils"
import {getValueAtPath, setValueAtPath} from "@agenta/shared/utils"
import deepEqual from "fast-deep-equal"
import type {WritableAtom} from "jotai"
import {atom} from "jotai"

import {configUpdateRouterAtom, memoAtom, moleculeSchemaAtPath, stableAtom} from "./atoms"
import {SIBLING_GROUP_KEYS, type SiblingGroupKey} from "./constants"
import {isEntitySchema, mergeSiblingFields, pathTargetsSibling} from "./schemaData"
import type {ConfigSectionMoleculeAdapter} from "./types"

/**
 * Build adapter backed by workflowMolecule.
 *
 * Data mapping:
 * - workflowMolecule.selectors.configuration(id) → `parameters` fields (UI display)
 * - sibling `data.*` fields (script/runtime/url/headers) surfaced alongside,
 *   read from the full resolved data and written via the raw draft action
 * - workflowMolecule.actions.updateConfiguration → parameter writes
 * - workflowMolecule.selectors.parametersSchema(id) → agConfigSchema
 */
function buildWorkflowMoleculeAdapter(): ConfigSectionMoleculeAdapter {
    return {
        atoms: {
            // deepEqual-stable: upstream selectors mint fresh objects per query flip during boot.
            data: memoAtom((id: string) =>
                stableAtom(
                    atom((get) => {
                        const config = get(workflowMolecule.selectors.configuration(id))
                        const full = get(workflowMolecule.selectors.resolvedData(id))
                        return mergeSiblingFields(config as Record<string, unknown> | null, full)
                    }),
                    deepEqual,
                ),
            ),
            serverData: memoAtom((id: string) =>
                stableAtom(
                    atom((get) => {
                        const config = get(workflowMolecule.selectors.serverConfiguration(id))
                        const full = get(workflowMolecule.selectors.serverData(id))
                        return mergeSiblingFields(config as Record<string, unknown> | null, full)
                    }),
                    deepEqual,
                ),
            ),
            draft: (id: string) => workflowMolecule.atoms.draft(id),
            isDirty: (id: string) => workflowMolecule.selectors.isDirty(id),
            schemaQuery: memoAtom((id: string) =>
                stableAtom(
                    atom((get) => {
                        const q = get(workflowMolecule.selectors.query(id))
                        const rawSchema = get(workflowMolecule.selectors.parametersSchema(id))
                        const schema = isEntitySchema(rawSchema) ? rawSchema : null
                        return {
                            isPending: q.isPending,
                            isError: q.isError,
                            error: q.error as Error | null,
                            data: {agConfigSchema: schema},
                        }
                    }),
                    (a, b) =>
                        a.isPending === b.isPending &&
                        a.isError === b.isError &&
                        a.error === b.error &&
                        a.data?.agConfigSchema === b.data?.agConfigSchema,
                ),
            ),
            agConfigSchema: memoAtom((id: string) =>
                atom((get) => {
                    const schema = get(workflowMolecule.selectors.parametersSchema(id))
                    return isEntitySchema(schema) ? schema : null
                }),
            ),
        },
        reducers: {
            update: configUpdateRouterAtom as WritableAtom<
                unknown,
                [id: string, changes: Record<string, unknown>],
                void
            >,
            discard: workflowMolecule.actions.discard,
        },
        drillIn: {
            // Flatten parameter keys + sibling fields to one level (each its own section).
            getRootData: (data: unknown) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                if (!d) return {}
                const {parameters, ...siblings} = d
                return {...(parameters ?? {}), ...siblings}
            },
            getRootItems: (data: unknown) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                const items: {key: string; name: string; value: unknown}[] = []
                const params = d?.parameters
                if (params && typeof params === "object") {
                    for (const [key, value] of Object.entries(params)) {
                        items.push({key, name: key, value})
                    }
                }
                for (const group of SIBLING_GROUP_KEYS) {
                    if (d && group in d) {
                        items.push({key: group, name: group, value: d[group as keyof typeof d]})
                    }
                }
                return items
            },
            getValueAtPath: (data: unknown, path: DataPath) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                if (!d) return undefined
                if (pathTargetsSibling(path, d)) return getValueAtPath(d, path)
                if (!d.parameters) return undefined
                return getValueAtPath(d.parameters, path)
            },
            getChangesFromPath: (data: unknown, path: DataPath, value: unknown) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                // Sibling edits emit a tagged __siblingData payload. setValueAtPath
                // is immutable, so use its return value.
                if (pathTargetsSibling(path, d)) {
                    const group = path[0] as SiblingGroupKey
                    const base = (d as Record<string, unknown>)?.[group] ?? {}
                    const fields = setValueAtPath(base, path.slice(1), value) as Record<
                        string,
                        unknown
                    >
                    if (group === "schemas") {
                        return {__siblingData: {schemas: fields}} as Record<string, unknown>
                    }
                    return {__siblingData: fields} as Record<string, unknown>
                }
                return setValueAtPath(d?.parameters ?? {}, path, value) as Record<string, unknown>
            },
            // rootData flattened: a sibling group edit emits a tagged payload of the
            // group's fields (paths drop the virtual group key); params emit param keys.
            getChangesFromRoot: (_entity: unknown, rootData: unknown, path: DataPath) => {
                const root = {...(rootData as Record<string, unknown>)}
                if (pathTargetsSibling(path, _entity)) {
                    const group = path[0] as SiblingGroupKey
                    const fields = (root[group] ?? {}) as Record<string, unknown>
                    // schemas nests under data.schemas; hook/code fields sit flat on data.
                    if (group === "schemas") {
                        return {__siblingData: {schemas: {...fields}}} as Record<string, unknown>
                    }
                    return {__siblingData: {...fields}} as Record<string, unknown>
                }
                // Only strip keys that are real sibling groups on the entity, so a
                // legacy parameter named "code"/"hook" survives in the param payload.
                const entity = _entity as Record<string, unknown> | null
                for (const group of SIBLING_GROUP_KEYS) {
                    if (entity && group in entity) delete root[group]
                }
                return root
            },
        },
        selectors: {
            schemaAtPath: moleculeSchemaAtPath,
        },
    }
}

export const defaultAdapter = buildWorkflowMoleculeAdapter()
