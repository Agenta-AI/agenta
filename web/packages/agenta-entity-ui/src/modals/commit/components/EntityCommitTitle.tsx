/**
 * EntityCommitTitle Component
 *
 * Modal title showing the entity being committed/created.
 * Uses `commitModalActionLabelAtom` for the action word (e.g., "Commit" or "Create").
 */

import {useAtomValue} from "jotai"

import {
    commitModalEntityNameAtom,
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
    const actionLabel = useAtomValue(commitModalActionLabelAtom)

    if (!entity) {
        return (
            <span>
                {actionLabel} <span className="font-semibold">Changes</span>
            </span>
        )
    }

    return (
        <span>
            {actionLabel} <span className="font-semibold">{entityName || "Changes"}</span>
        </span>
    )
}
