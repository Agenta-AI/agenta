import {Button} from "@agenta/primitive-ui/components/button"
import {Plus} from "@phosphor-icons/react"
import {Tooltip} from "antd"

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
                        onClick={onAddArrayItem}
                        className="!px-2"
                        variant="ghost"
                        size="icon-sm"
                    >
                        {<Plus size={14} />}
                    </Button>
                </Tooltip>
            )}
            {currentPathDataType === "object" && (
                <AddPropertyForm onAdd={onAddObjectProperty} mode="popover" />
            )}
        </div>
    )
}
