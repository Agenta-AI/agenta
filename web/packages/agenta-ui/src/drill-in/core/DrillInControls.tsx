/**
 * DrillInControls Component
 *
 * Controls for adding items/properties when drilling into arrays/objects.
 */

import {useState} from "react"

import {Plus} from "@phosphor-icons/react"

import {Button} from "../../components/ui/button"
import {Input} from "../../components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../components/ui/select"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../components/ui/tooltip"
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
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onAddArrayItem}
                                    className="!px-2"
                                >
                                    {<Plus size={14} />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Add item</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
                {currentPathDataType === "object" && !showAddProperty && (
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowAddProperty(true)}
                                    className="!px-2"
                                >
                                    {<Plus size={14} />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Add property</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>

            {/* Add property input form - with smooth transition */}
            {currentPathDataType === "object" && (
                <div
                    className={`flex items-center gap-2 px-2 bg-blue-50 rounded-md border border-solid border-blue-200 overflow-hidden transition-all duration-200 ease-in-out ${
                        showAddProperty
                            ? "max-h-20 py-2 opacity-100"
                            : "max-h-0 py-0 opacity-0 border-transparent"
                    }`}
                >
                    <Input
                        value={newPropertyName}
                        onChange={(e) => setNewPropertyName(e.target.value)}
                        placeholder="Property name"
                        size="default"
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
                        onValueChange={(value) => setNewPropertyType(value as PropertyType)}
                    >
                        <SelectTrigger className="w-[110px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {propertyTypeOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="default"
                        size="default"
                        onClick={handleAddProperty}
                        disabled={!newPropertyName.trim()}
                    >
                        Add
                    </Button>
                    <Button variant="ghost" size="default" onClick={handleCancelAddProperty}>
                        Cancel
                    </Button>
                </div>
            )}
        </>
    )
}
