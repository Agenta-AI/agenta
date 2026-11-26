/**
 * EntityCommitTitle Component
 *
 * Modal title showing the entity being committed/created.
 * Uses `commitModalActionLabelAtom` for the action word (e.g., "Commit" or "Create").
 */

import {richText, useT} from "@agenta/i18n"
import commitModalCatalog from "@agenta/i18n/catalogs/entityUi.commitModal"
import {useAtomValue} from "jotai"

import {
    commitModalEntityNameAtom,
    commitModalOriginalEntityNameAtom,
    commitModalEntityAtom,
    commitModalActionLabelAtom,
} from "../state"

/**
 * EntityCommitTitle
 *
 * Displays "{ActionLabel} {EntityName}" or "{ActionLabel} Changes" if no name.
 * ActionLabel defaults to "Commit" but can be set to "Create" etc.
 */
export function EntityCommitTitle() {
    const entity = useAtomValue(commitModalEntityAtom)
    const entityName = useAtomValue(commitModalEntityNameAtom)
    const originalEntityName = useAtomValue(commitModalOriginalEntityNameAtom)
    const actionLabel = useAtomValue(commitModalActionLabelAtom)
    const t = useT(commitModalCatalog)
    // "Commit" is the default action word; a host's own word is shown as it is.
    const action = actionLabel === "Commit" ? t("entityUi.commitModal.commit") : actionLabel
    const bold = {b: (text: string) => <span className="font-semibold">{text}</span>}

    if (!entity) {
        return <span>{richText(t("entityUi.commitModal.titleChanges", {action}), bold)}</span>
    }

    const displayName = actionLabel === "Commit" ? originalEntityName : entityName

    return (
        <span>
            {richText(
                displayName
                    ? t("entityUi.commitModal.titleName", {action, name: displayName})
                    : t("entityUi.commitModal.titleChanges", {action}),
                bold,
            )}
        </span>
    )
}
