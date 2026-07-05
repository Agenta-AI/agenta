import {useRef, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {Plus} from "@phosphor-icons/react"
import {Input, Select} from "antd"

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
            <Button onClick={handleAdd} disabled={!name.trim()} size="sm">
                Add
            </Button>
            <Button onClick={handleCancel} variant="ghost" size="sm">
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
            >
                <PopoverTrigger nativeButton={false} render={<span className="inline-flex" />}>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <button
                                    type="button"
                                    className="flex items-center justify-center w-6 h-6 rounded border-none cursor-pointer transition-colors bg-transparent text-[var(--ag-rgba-000-45)] hover:text-[var(--ag-c-1C2C3D)] hover:bg-[var(--ag-rgba-000-06)]"
                                >
                                    <Plus size={14} />
                                </button>
                            }
                        />
                        <TooltipContent>{open ? undefined : "Add property"}</TooltipContent>
                    </Tooltip>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start">
                    {formContent}
                </PopoverContent>
            </Popover>
        )
    }

    // Inline mode
    return (
        <div className="flex flex-col gap-2">
            {open ? (
                <div className="flex items-center gap-2 p-2 rounded-md border border-[var(--ag-rgba-000-06)] bg-[var(--ag-rgba-000-02)]">
                    {formContent}
                </div>
            ) : (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                onClick={() => setOpen(true)}
                                className="!px-2"
                                variant="ghost"
                                size="icon-sm"
                            >
                                {<Plus size={14} />}
                            </Button>
                        }
                    />
                    <TooltipContent>{"Add property"}</TooltipContent>
                </Tooltip>
            )}
        </div>
    )
}
