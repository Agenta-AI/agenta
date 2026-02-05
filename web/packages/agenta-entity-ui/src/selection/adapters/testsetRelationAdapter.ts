/**
 * Testset Selection Adapter (Relation-Based)
 *
 * Adapter for selecting testset revisions through the hierarchy:
 * Testset → Revision
 *
 * Uses EntityRelation definitions from @agenta/entities/testset.
 * This implementation uses the relation-based factory pattern, eliminating
 * boilerplate code and runtime configuration.
 *
 * The adapter uses atoms defined in the testset relations module,
 * which are auto-imported when this module is loaded.
 *
 * @example
 * ```typescript
 * import { testsetAdapter, TestsetSelectionResult } from '@agenta/entity-ui/selection'
 *
 * const { items, navigateDown, select } = useHierarchicalSelection({
 *   adapter: testsetAdapter,
 *   instanceId: 'my-selector',
 *   onSelect: (selection: TestsetSelectionResult) => {
 *     console.log('Selected testset revision:', selection.id)
 *   },
 * })
 * ```
 */

import React from "react"

// Import the registered relation and testset list atom from entities package
import type {EntityRelation} from "@agenta/entities/shared"
import {testsetToRevisionRelation, testsetsListAtom} from "@agenta/entities/testset"
import {RevisionLabel} from "@agenta/ui/components/presentational"
import type {Atom} from "jotai"

import type {EntitySelectionResult, ListQueryState, SelectionPathItem} from "../types"

import {createTwoLevelAdapter} from "./createAdapterFromRelations"

// ============================================================================
// TYPES
// ============================================================================

export interface TestsetSelectionResult extends EntitySelectionResult {
    type: "revision"
    metadata: {
        testsetId: string
        testsetName: string
        revisionId: string
        version: number
        commitMessage?: string
    }
}

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * Testset selection adapter using relation-based factory.
 *
 * Hierarchy: Testset → Revision
 *
 * This adapter is created at module load time using the atoms defined
 * in the testset relations module. No runtime configuration required.
 */
export const testsetAdapter = createTwoLevelAdapter<TestsetSelectionResult>({
    name: "testset",
    parentType: "testset",
    parentLabel: "Testset",
    parentListAtom: testsetsListAtom as Atom<ListQueryState<unknown>>,
    parentOverrides: {
        getId: (testset: unknown) => (testset as {id: string}).id,
        getLabel: (testset: unknown) => (testset as {name: string}).name,
        getDescription: (testset: unknown) => {
            const t = testset as {description?: string}
            return t.description
        },
        hasChildren: true,
        isSelectable: false,
    },
    childType: "revision",
    childLabel: "Revision",
    childRelation: testsetToRevisionRelation as EntityRelation<unknown, unknown>,
    childOverrides: {
        autoSelectSingle: true,
        getLabelNode: (entity: unknown) => {
            const r = entity as {
                version?: number
                message?: string | null
                created_at?: string | null
                author?: string | null
                created_by_id?: string | null
            }
            return React.createElement(RevisionLabel, {
                version: r.version ?? 0,
                message: r.message,
                createdAt: r.created_at,
                author: r.author ?? r.created_by_id,
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
    selectionType: "revision",
    toSelection: (path: SelectionPathItem[], leafEntity: unknown): TestsetSelectionResult => {
        const revision = leafEntity as {
            id: string
            version?: number
            revision?: number
            message?: string
        }
        const testset = path[0]
        const revisionItem = path[1]

        return {
            type: "revision",
            id: revision.id,
            label: `${testset?.label ?? "Testset"} / ${revisionItem?.label ?? "Revision"}`,
            path,
            metadata: {
                testsetId: testset?.id ?? "",
                testsetName: testset?.label ?? "",
                revisionId: revision.id,
                version: revision.version ?? revision.revision ?? 0,
                commitMessage: revision.message,
            },
        }
    },
    emptyMessage: "No testsets found",
    loadingMessage: "Loading testsets...",
})
