/**
 * EntitySaveTitle Component
 *
 * Modal title based on save context.
 */

import {useT} from "@agenta/i18n"
import saveModalCatalog from "@agenta/i18n/catalogs/entityUi.saveModal"
import {useAtomValue} from "jotai"

import {getEntityTypeLabel} from "../../types"
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
    // The title atom reads the text when it is computed; this draws it again once the text loads.
    useT(saveModalCatalog)
    const title = useAtomValue(saveModalTitleAtom)
    const entityType = useAtomValue(saveModalResolvedTypeAtom)

    const typeLabel = entityType ? getEntityTypeLabel(entityType, 1) : ""

    return (
        <span>
            {title}
            {typeLabel && <span className="font-normal text-gray-500"> {typeLabel}</span>}
        </span>
    )
}
