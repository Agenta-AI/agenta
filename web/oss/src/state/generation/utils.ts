import {displayedVariantsVariablesAtom} from "@/oss/components/Playground/state/atoms"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
// import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"

// PropertyNode is the shared structure used by variables and messages throughout UI
// Matches legacy format: __id-based nodes with optional __metadata and nested children/content
export interface PropertyNode {
    __id: string
    __metadata?: Record<string, any>
    content?: {value: any} | any
    value?: any
    children?: PropertyNode[]
    role?: string
    [k: string]: any
}

/**
 * Merge existing row variables with dynamic variable names for the provided revisions.
 * - Reuses existing nodes by key/name when present
 * - Creates new nodes for missing names with normalized metadata and empty values
 * - Deduplicates across revisions preserving first-seen order
 */
export function mergeRowVariables(
    get: <T>(anAtom: {read: (get: any) => T}) => T,
    existing: any[] | undefined,
    _revisionIds: string[],
    valueByName?: Record<string, string>,
): any[] {
    const existingFlat: any[] = Array.isArray(existing) ? existing : []
    const byName = new Map<string, any>()
    for (const n of existingFlat) {
        const k = (n as any)?.key ?? (n as any)?.__id
        if (typeof k === "string" && k) byName.set(k, n)
    }
    const seen = new Set<string>()
    const merged: any[] = []
    const allNames = (get(displayedVariantsVariablesAtom) || []) as string[]
    for (const name of allNames || []) {
        if (!name || seen.has(name)) continue
        seen.add(name)
        const existingNode = byName.get(name)
        if (existingNode) {
            const meta = (existingNode as any)?.__metadata || {
                type: "string",
                title: name,
                description: `Template variable: {{${name}}}`,
            }
            // Clone node and nested content to avoid mutating frozen objects
            const node: any = {
                ...existingNode,
                key: name,
                __metadata: meta,
            }
            if (
                (existingNode as any)?.content &&
                typeof (existingNode as any).content === "object"
            ) {
                node.content = {...(existingNode as any).content}
            }

            const cached = valueByName?.[name]
            const curVal = (existingNode as any)?.content?.value ?? (existingNode as any)?.value
            if (typeof cached === "string" && (!curVal || String(curVal).length === 0)) {
                if (node.content && typeof node.content === "object") node.content.value = cached
                node.value = cached
            }
            merged.push(node)
        } else {
            const cached = valueByName?.[name]
            merged.push({
                __id: generateId(),
                key: name,
                __metadata: {
                    type: "string",
                    title: name,
                    description: `Template variable: {{${name}}}`,
                },
                value: cached ?? "",
                content: {value: cached ?? ""},
            })
        }
    }
    return merged
}
