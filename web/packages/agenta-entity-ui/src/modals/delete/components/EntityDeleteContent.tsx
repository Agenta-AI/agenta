/**
 * EntityDeleteContent Component
 *
 * Modal content that displays entities grouped by type,
 * warnings, and any blocked entities.
 */

import {useMemo} from "react"

import {Alert, Typography} from "antd"
import {atom, useAtomValue} from "jotai"
import {Trash2} from "lucide-react"

import {getEntityAdapter} from "../../adapters"
import type {EntityGroup, EntityReference} from "../../types"
import {
    deleteModalGroupsAtom,
    deleteModalWarningsAtom,
    deleteModalBlockedAtom,
    deleteModalErrorAtom,
} from "../state"

const {Text} = Typography

/**
 * EntityDeleteContent
 *
 * Main content area showing:
 * - Entities grouped by type
 * - Warning messages from adapters
 * - Blocked entities that can't be deleted
 * - Error message if delete failed
 */
export function EntityDeleteContent() {
    const groups = useAtomValue(deleteModalGroupsAtom)
    const warnings = useAtomValue(deleteModalWarningsAtom)
    const blocked = useAtomValue(deleteModalBlockedAtom)
    const error = useAtomValue(deleteModalErrorAtom)

    return (
        <div className="flex flex-col gap-4">
            {/* Confirmation message */}
            <Text>
                Are you sure you want to delete the following? This action cannot be undone.
            </Text>

            {/* Entity groups */}
            {groups.map((group) => (
                <EntityGroupDisplay key={group.type} group={group} />
            ))}

            {/* Warnings */}
            {warnings.length > 0 && (
                <Alert
                    type="warning"
                    showIcon
                    message="Warning"
                    description={
                        <ul className="list-disc list-inside m-0 pl-0">
                            {warnings.map((warning, i) => (
                                <li key={i}>{warning}</li>
                            ))}
                        </ul>
                    }
                />
            )}

            {/* Blocked entities */}
            {blocked.length > 0 && (
                <Alert
                    type="error"
                    showIcon
                    message="Cannot Delete"
                    description={
                        <div>
                            <Text>The following items cannot be deleted:</Text>
                            <ul className="list-disc list-inside m-0 pl-0 mt-2">
                                {blocked.map((entity) => (
                                    <li key={entity.id}>
                                        <EntityNameDisplay entity={entity} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    }
                />
            )}

            {/* Error message */}
            {error && (
                <Alert type="error" showIcon message="Delete Failed" description={error.message} />
            )}
        </div>
    )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface EntityGroupDisplayProps {
    group: EntityGroup
}

/**
 * Display a group of entities
 */
function EntityGroupDisplay({group}: EntityGroupDisplayProps) {
    const adapter = getEntityAdapter(group.type)
    const Icon = adapter?.getIcon?.()

    return (
        <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
                {Icon ? (
                    <span className="text-gray-500">{Icon}</span>
                ) : (
                    <Trash2 size={16} className="text-gray-500" />
                )}
                <Text strong className="text-gray-700">
                    {group.displayLabel} ({group.entities.length})
                </Text>
            </div>
            <ul className="list-disc list-inside m-0 pl-4 space-y-1">
                {group.entities.map((entity) => (
                    <li key={entity.id} className="text-gray-600">
                        <EntityNameDisplay entity={entity} />
                    </li>
                ))}
            </ul>
        </div>
    )
}

interface EntityNameDisplayProps {
    entity: EntityReference
}

/**
 * Display an entity name, resolving via adapter if needed
 */
function EntityNameDisplay({entity}: EntityNameDisplayProps) {
    const adapter = getEntityAdapter(entity.type)

    // Memoize the data atom to avoid creating new atoms on every render
    const dataAtom = useMemo(
        () => (adapter ? adapter.dataAtom(entity.id) : null),
        [adapter, entity.id],
    )

    // Read entity data from adapter's atom
    const entityData = useAtomValue(dataAtom ?? emptyAtom)

    // If name is provided in the reference, use it
    if (entity.name) {
        return <span>{entity.name}</span>
    }

    // Try to resolve via adapter's getDisplayName
    if (adapter && entityData) {
        const displayName = adapter.getDisplayName(entityData)
        if (displayName && displayName !== entity.id) {
            return <span>{displayName}</span>
        }
    }

    return <span className="font-mono">{entity.id}</span>
}

// Empty atom for when no adapter is available
const emptyAtom = atom(() => null)
