/**
 * EntityDeleteTitle Component
 *
 * Modal title that displays the entity type(s) being deleted.
 */

import {useAtomValue} from "jotai"

import {deleteModalGroupsAtom, deleteModalCountAtom} from "../state"

/**
 * EntityDeleteTitle
 *
 * Renders the modal title based on entities being deleted.
 * Shows entity type(s) and count.
 */
export function EntityDeleteTitle() {
    const groups = useAtomValue(deleteModalGroupsAtom)
    const count = useAtomValue(deleteModalCountAtom)

    if (groups.length === 0) {
        return <span>Delete</span>
    }

    if (groups.length === 1) {
        const group = groups[0]
        return (
            <span>
                Delete {group.displayLabel}
                {count > 1 ? ` (${count})` : ""}
            </span>
        )
    }

    // Multiple entity types
    return <span>Delete {count} items</span>
}
