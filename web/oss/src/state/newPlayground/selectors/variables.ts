import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {inputRowsByIdAtom} from "@/oss/state/generation/entities"

/**
 * Variables Selectors (newPlayground)
 * Canonical variables are sourced from normalized input rows only.
 */
export const variablesByRevisionSelectorFamily = atomFamily((_params: {revisionId: string}) =>
    atom((get) => {
        const rows = get(inputRowsByIdAtom) as Record<string, any>
        const all: any[] = []
        for (const row of Object.values(rows || {})) {
            const nodes = (row?.variables || []) as any[]
            if (Array.isArray(nodes) && nodes.length > 0) all.push(...nodes)
        }
        return all
    }),
)

export const variableValuesSelectorFamily = atomFamily((params: {revisionId: string}) =>
    atom((get) => {
        const nodes = get(variablesByRevisionSelectorFamily(params)) as any[]
        const values: Record<string, string> = {}
        for (const n of nodes || []) {
            const key = (n as any)?.key ?? (n as any)?.__id
            if (!key) continue
            const v = (n as any)?.content?.value ?? (n as any)?.value
            values[key] = v !== undefined && v !== null ? String(v) : ""
        }
        return values
    }),
)
