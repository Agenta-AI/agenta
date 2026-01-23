/**
 * EntityCommitTitle Component
 *
 * Modal title showing the entity being committed.
 */

import {useAtomValue} from "jotai"

import {commitModalEntityNameAtom, commitModalEntityAtom} from "../state"

/**
 * EntityCommitTitle
 *
 * Displays "Commit {EntityName}" or "Commit Changes" if no name
 */
export function EntityCommitTitle() {
    const entity = useAtomValue(commitModalEntityAtom)
    const entityName = useAtomValue(commitModalEntityNameAtom)

    if (!entity) {
        return <span>Commit Changes</span>
    }

    return (
        <span>
            Commit <span className="font-semibold">{entityName || "Changes"}</span>
        </span>
    )
}
