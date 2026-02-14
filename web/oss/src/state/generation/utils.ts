import {generateId} from "@agenta/shared/utils"
import type {Getter, Setter} from "jotai"

import {displayedVariantsVariablesAtom} from "@/oss/components/Playground/state/atoms"
import {
    allChatTurnIdsMapAtom,
    chatTurnIdsAtom,
    chatTurnIdsByBaselineAtom,
    chatTurnsByIdAtom,
    // chatTurnsByIdAtom, // Moved
    chatTurnsByIdCacheAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"
import {responseByRowRevisionAtomFamily} from "@/oss/state/newPlayground/generation/runtime"

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
    get: Getter,
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

interface DuplicateChatHistoryParams {
    get: Getter
    set: Setter
    sourceRevisionId?: string | null
    targetRevisionId: string
    displayedVariantsAfterSwap?: string[]
}

export function duplicateChatHistoryForRevision({
    get,
    set,
    sourceRevisionId,
    targetRevisionId,
    displayedVariantsAfterSwap,
}: DuplicateChatHistoryParams) {
    if (!sourceRevisionId || !targetRevisionId || sourceRevisionId === targetRevisionId) return

    try {
        const baselineMap = get(chatTurnIdsByBaselineAtom) || {}
        let logicalIds: string[] = []
        if (
            Array.isArray(baselineMap[sourceRevisionId]) &&
            baselineMap[sourceRevisionId].length > 0
        )
            logicalIds = [...baselineMap[sourceRevisionId]]
        else {
            const currentLogical = get(chatTurnIdsAtom)
            logicalIds = Array.isArray(currentLogical) ? [...currentLogical] : []
        }

        if (logicalIds.length === 0) return

        const persistedTurns = get(chatTurnsByIdAtom) as Record<string, any>
        const cachedTurns = get(chatTurnsByIdCacheAtom) as Record<string, any>
        const mergedTurns: Record<string, any> = {
            ...(persistedTurns || {}),
            ...(cachedTurns || {}),
        }

        const updatedEntries: Record<string, any> = {}

        for (const [turnId, turnValue] of Object.entries(mergedTurns)) {
            if (!turnValue) continue
            const assistantMap = turnValue.assistantMessageByRevision || {}
            const toolMap = turnValue.toolResponsesByRevision || {}
            const hasAssistant = sourceRevisionId in assistantMap
            const hasTool = sourceRevisionId in toolMap
            if (!hasAssistant && !hasTool) continue

            const clonedTurn = structuredClone(turnValue)
            clonedTurn.id = turnId

            if (!clonedTurn.assistantMessageByRevision) clonedTurn.assistantMessageByRevision = {}
            if (hasAssistant && !(targetRevisionId in clonedTurn.assistantMessageByRevision)) {
                const assistantNode = clonedTurn.assistantMessageByRevision[sourceRevisionId]
                clonedTurn.assistantMessageByRevision[targetRevisionId] = assistantNode
                    ? structuredClone(assistantNode)
                    : null
            }

            if (!clonedTurn.toolResponsesByRevision) clonedTurn.toolResponsesByRevision = {}
            if (hasTool && !(targetRevisionId in clonedTurn.toolResponsesByRevision)) {
                const toolNodes = clonedTurn.toolResponsesByRevision[sourceRevisionId]
                clonedTurn.toolResponsesByRevision[targetRevisionId] = toolNodes
                    ? structuredClone(toolNodes)
                    : toolNodes
            }

            updatedEntries[turnId] = clonedTurn
        }

        if (Object.keys(updatedEntries).length > 0) {
            set(chatTurnsByIdCacheAtom, (prev) => ({
                ...(prev || {}),
                ...updatedEntries,
            }))
        }

        for (const logicalId of logicalIds) {
            try {
                const sourceResponse = get(
                    responseByRowRevisionAtomFamily({
                        rowId: logicalId,
                        revisionId: sourceRevisionId,
                    }),
                )
                if (sourceResponse !== undefined && sourceResponse !== null) {
                    set(
                        responseByRowRevisionAtomFamily({
                            rowId: logicalId,
                            revisionId: targetRevisionId,
                        }),
                        structuredClone(sourceResponse),
                    )
                }
            } catch {}

            try {
                const runStatusMap = get(runStatusByRowRevisionAtom) as Record<string, any>
                const sourceKey = `${logicalId}:${sourceRevisionId}`
                const targetKey = `${logicalId}:${targetRevisionId}`
                const sourceStatus = runStatusMap?.[sourceKey]
                if (sourceStatus) {
                    set(runStatusByRowRevisionAtom, (prev: Record<string, any>) => ({
                        ...(prev || {}),
                        [targetKey]: {...sourceStatus},
                    }))
                }
            } catch {}
        }

        set(chatTurnIdsByBaselineAtom, (prev) => ({
            ...(prev || {}),
            [targetRevisionId]: [...logicalIds],
        }))

        if (Array.isArray(displayedVariantsAfterSwap) && displayedVariantsAfterSwap.length > 0) {
            const newKey = `set:${[...displayedVariantsAfterSwap].sort().join("|")}`
            set(allChatTurnIdsMapAtom, (prev) => ({
                ...(prev || {}),
                [newKey]: [...logicalIds],
            }))
        }
    } catch (error) {
        console.warn("Failed to duplicate chat history", error)
    }
}
