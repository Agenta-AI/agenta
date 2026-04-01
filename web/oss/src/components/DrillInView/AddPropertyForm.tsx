import {useRef, useState} from "react"

import {Plus} from "@phosphor-icons/react"
import {Button, Input, Popover, Select, Tooltip} from "antd"

export type PropertyType = "string" | "number" | "boolean" | "object" | "array"

const propertyTypeOptions = [
    {label: "String", value: "string" as const},
    {label: "Number", value: "number" as const},
    {label: "Boolean", value: "boolean" as const},
    {label: "Object", value: "object" as const},
    {label: "Array", value: "array" as const},
]

interface AddPropertyFormProps {
    onAdd: (propertyName: string, propertyType: PropertyType) => void
    /** "inline" renders the form in-place; "popover" renders it in a popover attached to the trigger */
    mode?: "inline" | "popover"
}

/**
 * Shared form for adding a new property (name + type).
 * Supports inline and popover display modes.
 */
export function AddPropertyForm({onAdd, mode = "inline"}: AddPropertyFormProps) {
    const [open, setOpen] = useState(false)
    const [name, setName] = useState("")
    const [type, setType] = useState<PropertyType>("string")
    const inputRef = useRef<ReturnType<typeof Input>>(null)

    const handleAdd = () => {
        const trimmed = name.trim()
        if (!trimmed) return
        onAdd(trimmed, type)
        setName("")
        setType("string")
        setOpen(false)
    }

    const handleCancel = () => {
        setName("")
        setType("string")
        setOpen(false)
    }

    const formContent = (
        <div className="flex items-center gap-2">
            <Input
                ref={inputRef as any}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Property name"
                className="flex-1 max-w-[200px]"
                autoFocus
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        handleAdd()
                    } else if (e.key === "Escape") {
                        handleCancel()
                    }
                }}
            />
            <Select
                value={type}
                onChange={setType}
                size="small"
                style={{width: 90}}
                options={propertyTypeOptions}
            />
            <Button type="primary" size="small" onClick={handleAdd} disabled={!name.trim()}>
                Add
            </Button>
            <Button type="text" size="small" onClick={handleCancel}>
                Cancel
            </Button>
        </div>
    )

    if (mode === "popover") {
        return (
            <Popover
                open={open}
                onOpenChange={(visible) => {
                    setOpen(visible)
                    if (!visible) {
                        setName("")
                        setType("string")
                    }
                }}
                content={formContent}
                trigger="click"
                placement="bottomLeft"
                arrow={false}
            >
                <Tooltip title={open ? undefined : "Add property"}>
                    <button
                        type="button"
                        className="flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors bg-transparent text-[rgba(0,0,0,0.45)] hover:text-[#1c2c3d] hover:bg-[rgba(0,0,0,0.06)]"
                    >
                        <Plus size={14} />
                    </button>
                </Tooltip>
            </Popover>
        )
    }

    // Inline mode
    return (
        <div className="flex flex-col gap-2">
            {open ? (
                <div className="flex items-center gap-2 p-2 rounded-md border border-[rgba(0,0,0,0.06)] bg-[rgba(0,0,0,0.02)]">
                    {formContent}
                </div>
            ) : (
                <Tooltip title="Add property">
                    <Button
                        type="text"
                        size="small"
                        icon={<Plus size={14} />}
                        onClick={() => setOpen(true)}
                        className="!px-2"
                    />
                </Tooltip>
            )}
        </div>
    )
}
