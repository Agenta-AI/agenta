/**
 * Property-level atom selectors (residual)
 * Focused, high-signal selectors that remain after modularization.
 */

import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {appTypeAtom} from "./app"
import {playgroundStateAtom} from "./core"
import {revisionListAtom} from "./variants"

// Chat-related selectors are in generationProperties.ts. This file keeps only lightweight, generic selectors.

/**
 * Optimized chat detection selector
 * Returns a boolean derived from revision metadata: isChatVariant || isChat
 */
export const isChatVariantAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // App-level determination; ignore per-revision computation
        const appType = get(appTypeAtom)
        return appType === "chat"
    }),
)

/**
 * Message type detection
 * Detects message shape for UI controls: function/tool calls and JSON payloads.
 * Heuristics:
 *  - function: metadata.type === 'function' or presence of `function_call`
 *  - tool: metadata.type === 'tool' or presence of `tool_call`/`tool_calls`
 *  - JSON: content is object/array, or a string that parses as JSON
 */
export const messageTypeDetectionAtomFamily = atomFamily(
    (params: {variantId: string; messageId: string; rowId?: string}) =>
        atom((get) => {
            const {messageId} = params
            const playground = get(playgroundStateAtom)
            const messages = playground?.generationData?.messages?.value || []

            // Depth-first search for any node with matching __id
            const stack: any[] = Array.isArray(messages) ? [...messages] : []
            let node: any = null
            while (stack.length) {
                const cur = stack.pop()
                if (!cur) continue
                if (cur?.__id === messageId) {
                    node = cur
                    break
                }
                // Push likely nested containers
                if (Array.isArray(cur?.history?.value)) stack.push(...cur.history.value)
                if (Array.isArray(cur?.children)) stack.push(...cur.children)
                if (Array.isArray(cur)) stack.push(...cur)
            }

            const meta = node?.__metadata || node?.metadata
            const content = node?.content?.value ?? node?.content ?? node?.message?.content

            const isFunction = Boolean(meta?.type === "function" || node?.function_call)
            const isTool = Boolean(
                meta?.type === "tool" ||
                    node?.tool_call ||
                    (Array.isArray(node?.tool_calls) && node.tool_calls.length > 0),
            )

            let isJSON = false
            if (content && typeof content === "object") {
                isJSON = true
            } else if (typeof content === "string") {
                const trimmed = content.trim()
                if (
                    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                    (trimmed.startsWith("[") && trimmed.endsWith("]"))
                ) {
                    try {
                        JSON.parse(trimmed)
                        isJSON = true
                    } catch {
                        isJSON = false
                    }
                }
            }

            return {isFunction, isJSON, isTool}
        }),
)

/**
 * Atom for generation row IDs based on chat vs input mode
 * Used by MainLayout for rendering GenerationComparisonOutput and PlaygroundGenerations
 * Replaces complex legacy usePlayground subscription
 * PERFORMANCE OPTIMIZATION: Use selectAtom to prevent re-renders during local mutations
 */
// Moved to generationProperties.ts: generationRowIdsAtom

/**
 * Atom family for selecting a variant by revision ID
 * Provides optimized access to variant data using revision ID as key
 * Used throughout the app for variant-specific operations
 */
export const variantByRevisionIdAtomFamily = atomFamily((revisionId: string) =>
    selectAtom(
        atom((get) => get(revisionListAtom) || []),
        (revisions) => revisions.find((r: any) => r.id === revisionId) || null,
        isEqual,
    ),
)
