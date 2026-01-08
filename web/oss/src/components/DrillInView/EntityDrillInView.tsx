import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import type {EntityAPI, EntityDrillIn} from "@/oss/state/entities/shared"

import {DrillInContent} from "./DrillInContent"
import type {DrillInContentProps} from "./DrillInContent"

// Re-export PathItem for convenience
export type {PathItem} from "@/oss/state/entities/shared"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for EntityDrillInView
 *
 * Uses the unified EntityAPI for all state management.
 * Pass the entity controller and ID - the component handles the rest.
 */
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
     * The unified entity API (from createEntityController)
     * Must have drillIn capability configured
     */
    entity: EntityAPI<TEntity, any> & {drillIn: EntityDrillIn<TEntity>}

    /**
     * Optional columns (required for entities like testcase that use column-based structure)
     */
    columns?: unknown

    /**
     * Initial path to start navigation at (e.g., "inputs.prompt" or ["inputs", "prompt"])
     */
    initialPath?: string | string[]

    /**
     * Callback when navigation path changes (for persistence across navigation)
     */
    onPathChange?: (path: string[]) => void
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Generic entity-aware DrillInView component
 *
 * Uses the unified entity controller API for state management.
 * Provides path-based navigation and editing for nested entity data.
 *
 * Features:
 * - Efficient subscriptions (only subscribes to data changes)
 * - Dispatch-based mutations via controller
 * - Supports column-based entities (testcase) and key-based entities (trace)
 *
 * @example
 * ```tsx
 * import { testcase } from "@/state/entities/testcase"
 * import { traceSpan } from "@/state/entities/trace"
 *
 * // For testcase (requires columns)
 * <EntityDrillInView
 *   entityId={testcaseId}
 *   entity={testcase}
 *   columns={columns}
 *   editable
 * />
 *
 * // For trace span
 * <EntityDrillInView
 *   entityId={spanId}
 *   entity={traceSpan}
 *   editable={false}
 * />
 * ```
 */
export function EntityDrillInView<TEntity>({
    entityId,
    entity,
    columns,
    initialPath,
    onPathChange,
    ...drillInProps
}: EntityDrillInViewProps<TEntity>) {
    // Read entity from controller's data selector (efficient: only subscribes to data)
    const data = useAtomValue(entity.selectors.data(entityId))

    // Get dispatch function without subscribing to controller state
    const dispatch = useSetAtom(entity.controller(entityId))

    // getValue callback
    const getValue = useCallback(
        (path: string[]): unknown => {
            return entity.drillIn.getValueAtPath(data, path)
        },
        [data, entity.drillIn],
    )

    // setValue callback using dispatch API
    const setValue = useCallback(
        (path: string[], value: unknown) => {
            dispatch({type: "setAtPath", path, value})
        },
        [dispatch],
    )

    // getRootItems callback
    const getRootItems = useCallback(() => {
        if (columns !== undefined) {
            return entity.drillIn.getRootItems(data, columns)
        }
        return entity.drillIn.getRootItems(data)
    }, [data, columns, entity.drillIn])

    return (
        <DrillInContent
            getValue={getValue}
            setValue={setValue}
            getRootItems={getRootItems}
            valueMode={entity.drillIn.valueMode}
            initialPath={initialPath}
            onPathChange={onPathChange}
            {...drillInProps}
        />
    )
}
