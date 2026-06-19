/**
 * Evaluator Label Utilities
 *
 * Pure rendering functions for evaluator workflow items with colored type tags.
 * Moved from OSS `useEvaluatorBrowseAdapter.ts` to enable package-level reuse.
 *
 * Uses:
 * - `getWorkflowTypeColor` from `@agenta/entities/workflow` for consistent type colors
 * - `EntityListItemLabel` from `@agenta/ui` for the label + trailing tag layout
 */

import React from "react"

import {getWorkflowTypeColor} from "@agenta/entities/workflow"
import {EntityListItemLabel} from "@agenta/ui/components/presentational"

// ============================================================================
// TYPES
// ============================================================================

interface EvaluatorWorkflowLike {
    id: string
    name?: string
    flags?: {is_feedback?: boolean; is_custom?: boolean; is_evaluator?: boolean} | null
}

// ============================================================================
// RENDER FUNCTION
// ============================================================================

/**
 * Renders the colored type tag for an evaluator workflow item, or `undefined`
 * for non-evaluator workflows / unknown types.
 *
 * Tag resolution order:
 * 1. Human evaluators → "Human" tag from flags
 * 2. Custom evaluators → "Custom Code" tag from flags
 * 3. Built-in evaluators → display name looked up via evaluatorKeyMap + evaluatorDefsByKey
 *
 * @param entity - The workflow entity (must have `id`, `name`, `flags`)
 * @param evaluatorKeyMap - Map<workflowId, evaluatorKey> from revision data
 * @param evaluatorDefsByKey - Map<evaluatorKey, displayName> from template definitions
 */
export function renderEvaluatorTypeTag(
    entity: unknown,
    evaluatorKeyMap: Map<string, string>,
    evaluatorDefsByKey: Map<string, string>,
): React.ReactNode | undefined {
    const w = entity as EvaluatorWorkflowLike
    const evaluatorKey = evaluatorKeyMap.get(w.id)
    const isHumanEvaluator = Boolean(w.flags?.is_feedback) || evaluatorKey === "feedback"

    // Only show colored tags for evaluator-type workflows
    if (!w.flags?.is_evaluator && !isHumanEvaluator) {
        return undefined
    }

    // Resolve tag label and color key
    let tagLabel: string | null = null
    let colorSource: string | null = null

    if (isHumanEvaluator) {
        tagLabel = "Human"
        colorSource = "human"
    } else if (w.flags?.is_custom) {
        tagLabel = "Custom Code"
        colorSource = "custom"
    } else {
        if (evaluatorKey) {
            tagLabel = evaluatorDefsByKey.get(evaluatorKey) ?? null
            colorSource = evaluatorKey
        }
    }

    if (!tagLabel) return undefined

    const color = colorSource ? getWorkflowTypeColor(colorSource) : null

    return React.createElement(
        "span",
        {
            className: "text-[10px] px-1.5 py-0.5 rounded",
            style: color
                ? {
                      backgroundColor: color.bg,
                      color: color.text,
                      borderColor: color.border,
                      borderWidth: "1px",
                      borderStyle: "solid",
                  }
                : undefined,
        },
        tagLabel,
    )
}

/**
 * Renders an evaluator workflow item's name without a type tag. Pair with
 * `renderEvaluatorTypeTag` when the tag is rendered in a separate slot
 * (e.g., the picker row's suffix).
 */
export function renderEvaluatorPickerNameNode(entity: unknown): React.ReactNode {
    const w = entity as EvaluatorWorkflowLike
    return React.createElement(EntityListItemLabel, {label: w.name ?? "Unnamed"})
}

/**
 * Renders an evaluator workflow item with a colored type tag trailing the name.
 *
 * Non-evaluator workflows get a plain label without a tag. See
 * `renderEvaluatorTypeTag` for the tag resolution rules.
 *
 * @param entity - The workflow entity (must have `id`, `name`, `flags`)
 * @param evaluatorKeyMap - Map<workflowId, evaluatorKey> from revision data
 * @param evaluatorDefsByKey - Map<evaluatorKey, displayName> from template definitions
 */
export function renderEvaluatorPickerLabelNode(
    entity: unknown,
    evaluatorKeyMap: Map<string, string>,
    evaluatorDefsByKey: Map<string, string>,
): React.ReactNode {
    const w = entity as EvaluatorWorkflowLike
    const name = w.name ?? "Unnamed"
    const tag = renderEvaluatorTypeTag(entity, evaluatorKeyMap, evaluatorDefsByKey)

    if (!tag) {
        return React.createElement(EntityListItemLabel, {label: name})
    }

    return React.createElement(EntityListItemLabel, {
        label: name,
        trailing: tag,
    })
}

/**
 * Build a stable `getLabelNode` callback from evaluator maps.
 *
 * @param evaluatorKeyMap - Map<workflowId, evaluatorKey>
 * @param evaluatorDefsByKey - Map<evaluatorKey, displayName>
 * @returns A function `(entity: unknown) => ReactNode` suitable for adapter overrides
 */
export function buildEvaluatorPickerLabelNode(
    evaluatorKeyMap: Map<string, string>,
    evaluatorDefsByKey: Map<string, string>,
) {
    return (entity: unknown): React.ReactNode =>
        renderEvaluatorPickerLabelNode(entity, evaluatorKeyMap, evaluatorDefsByKey)
}
