import type {Atom, WritableAtom} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"
import {useCallback} from "react"

import {DrillInContent} from "./DrillInContent"
import type {DrillInContentProps, PathItem} from "./DrillInContent"

// ============================================================================
// TYPES
// ============================================================================

export interface EntityDrillInViewProps<TEntity>
    extends Omit<
        DrillInContentProps,
        "getValue" | "setValue" | "getRootItems" | "valueMode" | "initialPath"
    > {
    /**
     * The entity ID to read/write
     */
    entityId: string

    /**
     * Atom family that returns the entity (with draft if applicable)
     */
    entityAtomFamily: (id: string) => Atom<TEntity | null>

    /**
     * Helper to get value at a specific path in the entity
     */
    getValueAtPath: (entity: TEntity | null, path: string[]) => unknown

    /**
     * Write atom to set value at a specific path
     */
    setValueAtPathAtom: WritableAtom<
        null,
        [{id: string; path: string[]; value: unknown}],
        void
    >

    /**
     * Helper to get root-level items to display
     * May require columns for some entities (testcase), or not for others (trace)
     */
    getRootItems:
        | ((entity: TEntity | null) => PathItem[])
        | ((entity: TEntity | null, columns: any) => PathItem[])

    /**
     * Value mode for serialization
     * - "string": values are JSON strings
     * - "native": values are kept as-is
     */
    valueMode: "string" | "native"

    /**
     * Optional columns (required for entities like testcase that use column-based structure)
     */
    columns?: any

    /**
     * Initial path to start navigation at (e.g., "inputs.prompt" or ["inputs", "prompt"])
     */
    initialPath?: string | string[]
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Generic entity-aware DrillInView component
 * Automatically handles atom-based read/write operations for any entity
 *
 * This component unifies the pattern used across different entity types (testcase, trace, etc.)
 * by accepting entity-specific configuration and handling the atom operations internally.
 */
export function EntityDrillInView<TEntity>({
    entityId,
    entityAtomFamily,
    getValueAtPath,
    setValueAtPathAtom,
    getRootItems,
    valueMode,
    columns,
    initialPath,
    ...drillInProps
}: EntityDrillInViewProps<TEntity>) {
    // Read entity from atom (includes draft if applicable)
    const entity = useAtomValue(entityAtomFamily(entityId))

    // Write mutations
    const setValueAtPath = useSetAtom(setValueAtPathAtom)

    // getValue callback using entity-level helper
    const getValue = useCallback(
        (path: string[]): unknown => {
            return getValueAtPath(entity, path)
        },
        [entity, getValueAtPath],
    )

    // setValue callback using entity-level write atom
    const setValue = useCallback(
        (path: string[], value: unknown) => {
            setValueAtPath({id: entityId, path, value})
        },
        [entityId, setValueAtPath],
    )

    // getRootItems callback using entity-level helper
    // Handles both signatures: with or without columns parameter
    const getRootItemsCallback = useCallback(() => {
        if (columns !== undefined) {
            // Cast to function that accepts columns
            return (getRootItems as (entity: TEntity | null, columns: any) => PathItem[])(
                entity,
                columns,
            )
        }
        // Function without columns parameter
        return (getRootItems as (entity: TEntity | null) => PathItem[])(entity)
    }, [entity, columns, getRootItems])

    return (
        <DrillInContent
            getValue={getValue}
            setValue={setValue}
            getRootItems={getRootItemsCallback}
            valueMode={valueMode}
            initialPath={initialPath}
            {...drillInProps}
        />
    )
}
