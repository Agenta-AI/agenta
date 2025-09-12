import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {inputRowsByIdAtom} from "@/oss/state/generation/entities"

/**
 * Variables Selectors (canonical)
 *
 * These selectors expose variables from normalized input rows only.
 * Do not rely on session.variablesByRevision for payloads or logic.
 */

export const variablesByRevisionSelectorFamily = atomFamily((params: {revisionId: string}) =>
    atom((get) => {
        const {revisionId} = params
        const rows = get(inputRowsByIdAtom) as Record<string, any>
        const all: any[] = []
        for (const row of Object.values(rows || {})) {
            const byRev = (row as any)?.variablesByRevision || {}
            const nodes = (byRev?.[revisionId] || []) as any[]
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
            const key = n?.key ?? n?.__id
            if (!key) continue
            const v = n?.content?.value ?? n?.value
            values[key] = v !== undefined && v !== null ? String(v) : ""
        }
        return values
    }),
)
