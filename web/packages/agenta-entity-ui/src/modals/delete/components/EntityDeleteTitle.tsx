/**
 * EntityDeleteTitle Component
 *
 * Modal title that displays the entity type(s) being deleted.
 */

import {useT} from "@agenta/i18n"
import deleteModalCatalog from "@agenta/i18n/catalogs/entityUi.deleteModal"
import {useAtomValue} from "jotai"

import type {EntityType} from "../../types"
import {deleteModalGroupsAtom, deleteModalCountAtom} from "../state"

const DELETE_TITLE_KEYS = {
    testset: "entityUi.deleteModal.titleTestset",
    revision: "entityUi.deleteModal.titleRevision",
    variant: "entityUi.deleteModal.titleVariant",
    evaluator: "entityUi.deleteModal.titleEvaluator",
    application: "entityUi.deleteModal.titleApplication",
    simpleQueue: "entityUi.deleteModal.titleSimpleQueue",
} as const satisfies Record<EntityType, string>

/**
 * EntityDeleteTitle
 *
 * Renders the modal title based on entities being deleted.
 * Shows entity type(s) and count.
 */
export function EntityDeleteTitle() {
    const t = useT(deleteModalCatalog)
    const groups = useAtomValue(deleteModalGroupsAtom)
    const count = useAtomValue(deleteModalCountAtom)

    if (groups.length === 0) {
        return <span>{t("entityUi.deleteModal.title")}</span>
    }

    if (groups.length === 1) {
        const group = groups[0]
        return <span>{t(DELETE_TITLE_KEYS[group.type], {count})}</span>
    }

    // Multiple entity types
    return <span>{t("entityUi.deleteModal.titleItems", {count})}</span>
}
