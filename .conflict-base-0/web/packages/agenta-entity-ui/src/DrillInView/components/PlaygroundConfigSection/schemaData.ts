/**
 * Pure predicates and projections over the adapter's data + schema: schema type
 * guards, sibling-group (hook/code/schemas) detection and merging, path routing,
 * and the "is there anything renderable" / "which data to render" decisions.
 */

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import type {DataPath} from "@agenta/shared/utils"

import {SIBLING_GROUP_KEYS, SIBLING_GROUPS, type SiblingGroupKey} from "./constants"
import type {PathSchema} from "./types"

export function isEntitySchema(value: unknown): value is PathSchema {
    if (!value || typeof value !== "object") return false
    const schemaType = (value as Record<string, unknown>).type
    return typeof schemaType === "string"
}

export function hasParameters(
    data: {parameters?: Record<string, unknown>} | null | undefined,
): boolean {
    return Boolean(data?.parameters && Object.keys(data.parameters).length > 0)
}

export function isSiblingGroupKey(key: unknown): key is SiblingGroupKey {
    return typeof key === "string" && key in SIBLING_GROUPS
}

// custom:hook → hook group, custom:code → code group (uri = provider:kind:key:version).
function allowedSiblingGroup(uri: unknown): SiblingGroupKey | null {
    if (typeof uri !== "string") return null
    const [, kind, key] = uri.split(":")
    if (kind !== "custom") return null
    return isSiblingGroupKey(key) ? key : null
}

// Editable schemas (Parameters/Inputs/Outputs) belong only to custom workflows; legacy
// builtin evaluators carry a fixed, server-owned schema that must not be edited here.
function isCustomWorkflowUri(uri: unknown): boolean {
    if (typeof uri !== "string") return false
    return uri.split(":")[1] === "custom"
}

// Adapter data: `parameters` + one sibling group (hook/code) as a single section.
export function mergeSiblingFields(
    config: Record<string, unknown> | null,
    full: {data?: Record<string, unknown> | null} | null,
): Record<string, unknown> | null {
    const fullData = (full?.data ?? null) as Record<string, unknown> | null
    const group = allowedSiblingGroup(fullData?.uri)
    const merged: Record<string, unknown> = {parameters: (config ?? {}) as Record<string, unknown>}
    if (group && fullData) {
        const SIBLING_FIELD_DEFAULTS: Record<string, unknown> = {headers: {}, runtime: "python"}
        const fields: Record<string, unknown> = {}
        for (const field of SIBLING_GROUPS[group]) {
            fields[field] = fullData[field] ?? SIBLING_FIELD_DEFAULTS[field] ?? ""
        }
        merged[group] = fields
    }
    // `schemas` nests under data.schemas; editable only for custom workflows.
    const schemas = fullData?.schemas as Record<string, unknown> | null | undefined
    if (schemas && typeof schemas === "object" && isCustomWorkflowUri(fullData?.uri)) {
        const fields: Record<string, unknown> = {}
        for (const field of SIBLING_GROUPS.schemas) {
            fields[field] = schemas[field] ?? {}
        }
        merged.schemas = fields
    }
    if (!config && !group && !merged.schemas) return null
    return merged
}

// A path targets a sibling group only when path[0] is a group key AND that group is
// actually present on the data object. Guards against a legacy *parameter* named
// "code"/"hook" (path ["code"]) being misrouted as a sibling write.
export function pathTargetsSibling(path: DataPath, data: unknown): boolean {
    if (path.length === 0 || !isSiblingGroupKey(path[0])) return false
    const d = data as Record<string, unknown> | null
    return !!d && path[0] in d
}

// Renderable if there are parameters OR any sibling group (hook/code/schemas),
// so sibling-only workflows aren't hidden as "No configuration needed".
export function hasRenderableConfigSections(data: unknown): boolean {
    if (!data || typeof data !== "object") return false
    const record = data as Record<string, unknown>
    if (hasParameters(record)) return true
    return SIBLING_GROUP_KEYS.some((group) => record[group] !== undefined)
}

// Best-available data for render/loading decisions: draft-merged data, else server data.
export function pickActiveData<T extends {parameters?: Record<string, unknown>}>(
    useServerData: boolean,
    data: T | null,
    serverData: T | null,
): T | null {
    if (useServerData) return serverData
    if (hasParameters(data)) return data
    if (hasParameters(serverData)) return serverData
    return data ?? serverData
}

// Minimal object schema so the section is recognized; the hook/code body renders
// via HookCodeConfigControl, not the schema renderer, so no field schemas needed.
export function siblingSchemaAtPath(path: (string | number)[]): PathSchema | null {
    const group = path[0]
    if (!isSiblingGroupKey(group)) return null
    if (path.length === 1) {
        return {type: "object", title: group} as EntitySchemaProperty
    }
    return null
}
