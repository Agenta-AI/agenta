/**
 * MoleculeDrillInFieldList Component
 *
 * Renders the list of fields at the current navigation path.
 * Uses context for state and delegates to FieldItem for each field.
 */

import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import drillInCatalog from "@agenta/i18n/catalogs/entityUi.drillIn"
import {type PathItem, getItemsAtPath} from "@agenta/shared/utils"

import {useDrillIn} from "./MoleculeDrillInContext"
import {MoleculeDrillInFieldItem} from "./MoleculeDrillInFieldItem"

// ============================================================================
// COMPONENT
// ============================================================================

export function MoleculeDrillInFieldList() {
    const t = useT(drillInCatalog)
    const {rootData, currentPath, classNames, styles, slots} = useDrillIn()

    // Get items at current path (uses rootData, not full entity)
    const items = useMemo((): PathItem[] => {
        if (!rootData) return []
        return getItemsAtPath(rootData, currentPath)
    }, [rootData, currentPath])

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
                {t("entityUi.drillIn.noItems")}
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
