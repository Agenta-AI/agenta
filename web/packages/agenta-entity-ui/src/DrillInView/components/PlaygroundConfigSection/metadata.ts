/**
 * `agenta_metadata` strip / collect / re-attach helpers. The JSON and YAML views
 * hide this internal tool metadata, then restore it when the user saves an edit.
 */

/**
 * Recursively strip `agenta_metadata` from tool objects in the parameters tree.
 * Returns a new object safe for display in JSON/YAML view and a map of stripped
 * metadata keyed by stable path so it can be re-attached after editing.
 */
export type MetadataMap = Map<string, unknown>

export function stripAgentaMetadata(params: Record<string, unknown>): Record<string, unknown> {
    return stripRecursive(params) as Record<string, unknown>
}

function stripRecursive(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => stripRecursive(item))
    }
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            if (k === "agenta_metadata") continue
            result[k] = stripRecursive(v)
        }
        return result
    }
    return value
}

/**
 * Collect all agenta_metadata values from the original parameters,
 * keyed by their JSON path (e.g. "prompt.llm_config.tools.0").
 */
export function collectAgentaMetadata(
    value: unknown,
    path = "",
    map: MetadataMap = new Map(),
): MetadataMap {
    if (Array.isArray(value)) {
        value.forEach((item, i) => collectAgentaMetadata(item, path ? `${path}.${i}` : `${i}`, map))
    } else if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>
        if ("agenta_metadata" in obj) {
            map.set(path, obj.agenta_metadata)
        }
        for (const [k, v] of Object.entries(obj)) {
            if (k === "agenta_metadata") continue
            collectAgentaMetadata(v, path ? `${path}.${k}` : k, map)
        }
    }
    return map
}

/**
 * Re-inject agenta_metadata values into a parsed parameters object
 * using the metadata map collected from the original.
 */
export function reattachAgentaMetadata(
    value: unknown,
    metadataMap: MetadataMap,
    path = "",
): unknown {
    if (Array.isArray(value)) {
        return value.map((item, i) =>
            reattachAgentaMetadata(item, metadataMap, path ? `${path}.${i}` : `${i}`),
        )
    }
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            result[k] = reattachAgentaMetadata(v, metadataMap, path ? `${path}.${k}` : k)
        }
        const meta = metadataMap.get(path)
        if (meta !== undefined) {
            result.agenta_metadata = meta
        }
        return result
    }
    return value
}
