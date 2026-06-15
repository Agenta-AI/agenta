/**
 * EntityCommitTitle Component
 *
 * Modal title showing the entity being committed/created.
 * Uses `commitModalActionLabelAtom` for the action word (e.g., "Commit" or "Create").
 */

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

    if (!entity) {
        return (
            <span>
                {actionLabel} <span className="font-semibold">Changes</span>
            </span>
        )
    }

    const displayName = actionLabel === "Commit" ? originalEntityName : entityName

    return (
        <span>
            {actionLabel} <span className="font-semibold">{displayName || "Changes"}</span>
        </span>
    )
}
