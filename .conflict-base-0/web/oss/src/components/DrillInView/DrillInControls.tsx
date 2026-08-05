import {Plus} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {AddPropertyForm} from "./AddPropertyForm"
import type {PropertyType} from "./AddPropertyForm"

export type {PropertyType}

export interface DrillInControlsProps {
    /** Type of data at current path: array, object, root, or null */
    currentPathDataType: "array" | "object" | "root" | null
    /** Callback to add a new array item */
    onAddArrayItem: () => void
    /** Callback to add a new object property */
    onAddObjectProperty: (propertyName: string, propertyType: PropertyType) => void
}

/**
 * Controls for adding items/properties when drilling into arrays/objects.
 * Shows:
 * - "Add item" button for arrays
 * - "Add property" popover for objects
 */
export function DrillInControls({
    currentPathDataType,
    onAddArrayItem,
    onAddObjectProperty,
}: DrillInControlsProps) {
    return (
        <div className="flex items-center gap-2">
            {currentPathDataType === "array" && (
                <Tooltip title="Add item">
                    <Button
                        type="text"
                        size="small"
                        icon={<Plus size={14} />}
                        onClick={onAddArrayItem}
                        className="!px-2"
                    />
                </Tooltip>
            )}
            {currentPathDataType === "object" && (
                <AddPropertyForm onAdd={onAddObjectProperty} mode="popover" />
            )}
        </div>
    )
}
