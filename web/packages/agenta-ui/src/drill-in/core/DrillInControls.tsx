/**
 * DrillInControls Component
 *
 * Controls for adding items/properties when drilling into arrays/objects.
 */

import {useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {Plus} from "@phosphor-icons/react"
import {Input, Tooltip} from "antd"

import type {PropertyType} from "../coreTypes"

export interface DrillInControlsProps {
    /** Type of data at current path: array, object, or null */
    currentPathDataType: "array" | "object" | "root" | null
    /** Callback to add a new array item */
    onAddArrayItem: () => void
    /** Callback to add a new object property */
    onAddObjectProperty: (propertyName: string, propertyType: PropertyType) => void
}

const propertyTypeOptions = [
    {label: "String", value: "string" as const},
    {label: "Number", value: "number" as const},
    {label: "Boolean", value: "boolean" as const},
    {label: "Object", value: "object" as const},
    {label: "Array", value: "array" as const},
]

/**
 * Controls for adding items/properties when drilling into arrays/objects.
 * Shows:
 * - "Add item" button for arrays
 * - "Add property" button + inline form for objects
 */
export function DrillInControls({
    currentPathDataType,
    onAddArrayItem,
    onAddObjectProperty,
}: DrillInControlsProps) {
    const [showAddProperty, setShowAddProperty] = useState(false)
    const [newPropertyName, setNewPropertyName] = useState("")
    const [newPropertyType, setNewPropertyType] = useState<PropertyType>("string")

    const handleAddProperty = () => {
        if (newPropertyName.trim()) {
            onAddObjectProperty(newPropertyName.trim(), newPropertyType)
            setNewPropertyName("")
            setNewPropertyType("string")
            setShowAddProperty(false)
        }
    }

    const handleCancelAddProperty = () => {
        setNewPropertyName("")
        setNewPropertyType("string")
        setShowAddProperty(false)
    }

    return (
        <>
            {/* Add item/property buttons */}
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
                {currentPathDataType === "object" && !showAddProperty && (
                    <Tooltip title="Add property">
                        <Button
                            onClick={() => setShowAddProperty(true)}
                            className="!px-2"
                            variant="ghost"
                            size="icon-sm"
                        >
                            {<Plus size={14} />}
                        </Button>
                    </Tooltip>
                )}
            </div>

            {/* Add property input form - with smooth transition */}
            {currentPathDataType === "object" && (
                <div
                    className={`flex items-center gap-2 px-2 bg-blue-50 rounded-md border border-blue-200 overflow-hidden transition-all duration-200 ease-in-out ${
                        showAddProperty
                            ? "max-h-20 py-2 opacity-100"
                            : "max-h-0 py-0 opacity-0 border-transparent"
                    }`}
                >
                    <Input
                        value={newPropertyName}
                        onChange={(e) => setNewPropertyName(e.target.value)}
                        placeholder="Property name"
                        size="middle"
                        className="flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleAddProperty()
                            } else if (e.key === "Escape") {
                                handleCancelAddProperty()
                            }
                        }}
                    />
                    <Select
                        value={newPropertyType}
                        onValueChange={(v) => setNewPropertyType(v as PropertyType)}
                    >
                        <SelectTrigger style={{width: 110}}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {propertyTypeOptions.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={handleAddProperty} disabled={!newPropertyName.trim()}>
                        Add
                    </Button>
                    <Button onClick={handleCancelAddProperty} variant="ghost">
                        Cancel
                    </Button>
                </div>
            )}
        </>
    )
}
