/**
 * Evaluator Revision Selection Adapter (2-Level, Relation-Based)
 *
 * Adapter for selecting evaluator revisions through a 2-level hierarchy:
 * Evaluator → Revision (skips the Variant level)
 *
 * Uses EntityRelation definitions from @agenta/entities/evaluator.
 * This implementation uses the relation-based factory pattern, eliminating
 * boilerplate code and runtime configuration.
 *
 * The adapter is designed for the `list-popover` EntityPicker variant,
 * which requires exactly 2 levels.
 *
 * @example
 * ```typescript
 * import { evaluatorRevisionRelationAdapter, EvaluatorRevisionRelationSelectionResult }
 *   from '@agenta/entity-ui/selection'
 *
 * <EntityPicker<EvaluatorRevisionRelationSelectionResult>
 *   variant="list-popover"
 *   adapter="evaluatorRevisionRelation"
 *   onSelect={(selection) => {
 *     console.log('Selected revision:', selection.metadata.revisionId)
 *   }}
 *   autoSelectLatest
 *   selectLatestOnParentClick
 * />
 * ```
 */

import React from "react"

import {evaluatorToRevisionRelation, evaluatorsListAtom} from "@agenta/entities/evaluator"
import type {EntityRelation} from "@agenta/entities/shared"
import {RevisionLabel} from "@agenta/ui/components/presentational"
import type {Atom} from "jotai"

import type {EntitySelectionResult, ListQueryState, SelectionPathItem} from "../types"

import {createTwoLevelAdapter} from "./createAdapterFromRelations"

// ============================================================================
// TYPES
// ============================================================================

export interface EvaluatorRevisionRelationSelectionResult extends EntitySelectionResult {
    type: "evaluatorRevision"
    metadata: {
        evaluatorId: string
        evaluatorName: string
        revisionId: string
        version: number
    }
}

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * Evaluator revision selection adapter using relation-based factory.
 *
 * Hierarchy: Evaluator → Revision (2-level, skips Variant)
 *
 * This adapter supports:
 * - `list-popover` variant (designed for 2-level hierarchies)
 * - `cascading` variant (works with any number of levels)
 * - `breadcrumb` variant (works with any number of levels)
 *
 * For the 3-level hierarchy (Evaluator → Variant → Revision),
 * use the runtime-configured `evaluatorRevisionAdapter` instead.
 */
export const evaluatorRevisionRelationAdapter =
    createTwoLevelAdapter<EvaluatorRevisionRelationSelectionResult>({
        name: "evaluatorRevisionRelation",
        parentType: "evaluator",
        parentLabel: "Evaluator",
        parentListAtom: evaluatorsListAtom as Atom<ListQueryState<unknown>>,
        parentOverrides: {
            getId: (evaluator: unknown) => {
                const e = evaluator as {id?: string; workflow_id?: string}
                return e.id ?? e.workflow_id ?? ""
            },
            getLabel: (evaluator: unknown) => {
                const e = evaluator as {name?: string; slug?: string}
                return e.name ?? e.slug ?? "Unnamed"
            },
            getDescription: (evaluator: unknown) => {
                const e = evaluator as {description?: string}
                return e.description ?? undefined
            },
            hasChildren: true,
            isSelectable: false,
        },
        childType: "evaluatorRevision",
        childLabel: "Revision",
        childRelation: evaluatorToRevisionRelation as EntityRelation<unknown, unknown>,
        childOverrides: {
            autoSelectSingle: true,
            getLabelNode: (entity: unknown) => {
                const r = entity as {
                    version?: number
                    name?: string | null
                    created_at?: string | null
                    created_by_id?: string | null
                }
                return React.createElement(RevisionLabel, {
                    version: r.version ?? 0,
                    message: r.name,
                    createdAt: r.created_at,
                    author: r.created_by_id,
                    maxMessageWidth: 180,
                })
            },
            getPlaceholderNode: (text: string) =>
                React.createElement(
                    "div",
                    {className: "flex flex-col gap-0.5"},
                    React.createElement("span", {className: "text-zinc-400"}, text),
                    React.createElement("span", {className: "invisible"}, "\u00A0"),
                ),
        },
        selectionType: "evaluatorRevision",
        toSelection: (
            path: SelectionPathItem[],
            leafEntity: unknown,
        ): EvaluatorRevisionRelationSelectionResult => {
            const revision = leafEntity as {
                id: string
                version?: number
                name?: string
            }
            const evaluator = path[0]
            const revisionItem = path[1]

            return {
                type: "evaluatorRevision",
                id: revision.id,
                label: `${evaluator?.label ?? "Evaluator"} / ${revisionItem?.label ?? "Revision"}`,
                path,
                metadata: {
                    evaluatorId: evaluator?.id ?? "",
                    evaluatorName: evaluator?.label ?? "",
                    revisionId: revision.id,
                    version: revision.version ?? 0,
                },
            }
        },
        emptyMessage: "No evaluators found",
        loadingMessage: "Loading evaluators...",
    })
