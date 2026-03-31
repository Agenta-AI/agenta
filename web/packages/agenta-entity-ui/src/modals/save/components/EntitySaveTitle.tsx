/**
 * EntitySaveTitle Component
 *
 * Modal title based on save context.
 */

import {useAtomValue} from "jotai"

import {saveModalTitleAtom, saveModalResolvedTypeAtom} from "../state"

/**
 * EntitySaveTitle
 *
 * Displays:
 * - "Create New {Type}" for new entities
 * - "Save As {Type}" for save-as-new
 * - "Save {Type}" for regular save
 */
export function EntitySaveTitle() {
    const title = useAtomValue(saveModalTitleAtom)
    const entityType = useAtomValue(saveModalResolvedTypeAtom)

    // Capitalize entity type
    const typeLabel = entityType ? entityType.charAt(0).toUpperCase() + entityType.slice(1) : ""

    return (
        <span>
            {title}
            {typeLabel && <span className="font-normal text-gray-500"> {typeLabel}</span>}
        </span>
    )
}
