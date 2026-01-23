/**
 * MoleculeDrillInFieldList Component
 *
 * Renders the list of fields at the current navigation path.
 * Uses context for state and delegates to FieldItem for each field.
 */

import {useMemo} from "react"

import {type PathItem, getItemsAtPath} from "@agenta/shared"

import {useDrillIn} from "./MoleculeDrillInContext"
import {MoleculeDrillInFieldItem} from "./MoleculeDrillInFieldItem"

// ============================================================================
// COMPONENT
// ============================================================================

export function MoleculeDrillInFieldList() {
    const {entity, currentPath, classNames, styles, slots} = useDrillIn()

    // Get items at current path
    const items = useMemo((): PathItem[] => {
        if (!entity) return []
        return getItemsAtPath(entity, currentPath)
    }, [entity, currentPath])

    // Render empty state if no items
    if (items.length === 0) {
        // Use empty slot if provided
        if (slots?.empty) {
            return (
                <>
                    {slots.empty({
                        path: currentPath,
                        isRoot: currentPath.length === 0,
                    })}
                </>
            )
        }

        return (
            <div className={classNames.empty} style={styles?.empty}>
                No items to display
            </div>
        )
    }

    return (
        <div className={classNames.fieldList} style={styles?.fieldList}>
            {items.map((item) => (
                <MoleculeDrillInFieldItem key={item.key} item={item} />
            ))}
        </div>
    )
}
