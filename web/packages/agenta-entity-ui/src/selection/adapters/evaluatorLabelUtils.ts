/**
 * Evaluator Label Utilities
 *
 * Pure rendering functions for evaluator workflow items with colored type tags.
 * Moved from OSS `useEvaluatorBrowseAdapter.ts` to enable package-level reuse.
 *
 * Uses:
 * - `getEvaluatorColor` from `@agenta/entities/workflow` for consistent color hashing
 * - `EntityListItemLabel` from `@agenta/ui` for the label + trailing tag layout
 */

import React from "react"

import {getEvaluatorColor} from "@agenta/entities/workflow"
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
 * Renders an evaluator workflow item with a colored type tag.
 *
 * Tag resolution order:
 * 1. Human evaluators → "Human" tag from flags
 * 2. Custom evaluators → "Custom Code" tag from flags
 * 3. Built-in evaluators → display name looked up via evaluatorKeyMap + evaluatorDefsByKey
 *
 * Non-evaluator workflows get a plain label without a tag.
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

    // Only show colored tags for evaluator-type workflows
    if (!w.flags?.is_evaluator) {
        return React.createElement(EntityListItemLabel, {label: name})
    }

    // Resolve tag label and color key
    let tagLabel: string | null = null
    let colorSource: string | null = null

    if (w.flags?.is_feedback) {
        tagLabel = "Human"
        colorSource = "human"
    } else if (w.flags?.is_custom) {
        tagLabel = "Custom Code"
        colorSource = "custom"
    } else {
        const evaluatorKey = evaluatorKeyMap.get(w.id)
        if (evaluatorKey) {
            tagLabel = evaluatorDefsByKey.get(evaluatorKey) ?? null
            colorSource = evaluatorKey
        }
    }

    const color = colorSource ? getEvaluatorColor(colorSource) : null

    const tag = tagLabel
        ? React.createElement(
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
        : undefined

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
