/**
 * ParameterNodeEditor
 *
 * The right-hand detail of the tool-parameter master/detail editor: a contextual editor for the
 * one parameter node selected in {@link ParameterTree}. An `EDITING · PATH` breadcrumb then a stack
 * of shared {@link RailField} `[label │ control]` rows — Name (rename) / Type / Item type (arrays) /
 * Allowed values + Default (scalars only) / Description / Required. A container node (object, or
 * array-of-object) also gets an inline "Add property" button so children can be added while editing
 * the container. Other advanced shapes (formats, unions, tuples, ranges) stay in the JSON toggle.
 *
 * All edits go through the immutable helpers in {@link schemaPaths} against the whole `parameters`
 * root; a rename also moves the selection to the new key. Dark-safe (`--ag-color*` tokens only).
 */
import {useEffect, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {TagInput} from "@agenta/primitive-ui/components/tags-input"
import {Plus} from "@phosphor-icons/react"
import {Input, Switch} from "antd"

import {RailField} from "../../../drawers/shared/RailField"

import {
    defType,
    getNodeAt,
    getProps,
    isRequiredAt,
    ITEM_TYPE_OPTIONS,
    itemsSchema,
    leafKey,
    parentPath,
    pathLabel,
    renamePropertyAt,
    setNodeAt,
    toggleRequiredAt,
    TYPE_OPTIONS,
    type Schema,
    type Seg,
} from "./schemaPaths"

// Enum/default apply only to scalar leaves; object/array/boolean don't show those rows.
const SCALAR_TYPES = new Set(["string", "number", "integer"])

// Coerce a raw string to the parameter's JSON type; null when it can't (e.g. "abc" as a number, or
// "1.5" as an integer — rejected rather than silently truncated).
function coerceTo(raw: unknown, targetType: string): string | number | null {
    if (targetType === "number" || targetType === "integer") {
        const n = Number(raw)
        if (!Number.isFinite(n)) return null
        if (targetType === "integer" && !Number.isInteger(n)) return null
        return n
    }
    return String(raw)
}

export interface ParameterNodeEditorProps {
    /** The function tool's `parameters` root schema. */
    schema: Schema
    /** Path to the selected node (ends in a property step). */
    path: Seg[]
    onChange: (nextRoot: Schema) => void
    /** Move the selection (used after a rename). */
    onPathChange: (nextPath: Seg[]) => void
    /** Add a child property under the object at `containerPath` (host adds it + selects it). */
    onAddChild: (containerPath: Seg[]) => void
    disabled?: boolean
}

export function ParameterNodeEditor({
    schema,
    path,
    onChange,
    onPathChange,
    onAddChild,
    disabled,
}: ParameterNodeEditorProps) {
    const def = getNodeAt(schema, path) ?? {type: "string"}
    const key = leafKey(path) ?? ""
    const parent = parentPath(path)
    const type = defType(def)
    const description = typeof def.description === "string" ? def.description : ""

    const [nameLocal, setNameLocal] = useState(key)
    useEffect(() => setNameLocal(key), [key])

    const commitName = () => {
        const next = nameLocal.trim()
        if (next && next !== key) {
            const nextRoot = renamePropertyAt(schema, parent, key, next)
            if (nextRoot !== schema) {
                onChange(nextRoot)
                onPathChange([...parent, {p: next}])
                return
            }
        }
        setNameLocal(key)
    }

    const isScalar = SCALAR_TYPES.has(type)
    const enumValues: string[] = Array.isArray(def.enum)
        ? (def.enum as unknown[]).map((v) => String(v))
        : []
    const defaultValue = def.default

    const changeType = (next: string) => {
        const base: Schema = {}
        if (description) base.description = description
        // Preserve (re-coerce) enum/default across scalar↔scalar changes; drop on structural change.
        if (SCALAR_TYPES.has(next)) {
            if (Array.isArray(def.enum)) {
                const vals = (def.enum as unknown[])
                    .map((v) => coerceTo(v, next))
                    .filter((v): v is string | number => v !== null)
                if (vals.length) base.enum = vals
            }
            if (defaultValue !== undefined) {
                const d = coerceTo(defaultValue, next)
                if (d !== null && (!Array.isArray(base.enum) || base.enum.includes(d)))
                    base.default = d
            }
        }
        const nextDef: Schema =
            next === "object"
                ? {type: "object", properties: {}, required: [], ...base}
                : next === "array"
                  ? {type: "array", items: {type: "string"}, ...base}
                  : {type: next, ...base}
        onChange(setNodeAt(schema, path, nextDef))
    }

    // Allowed values (enum): free-text tags, coerced to the parameter's type. Clearing all values
    // drops the constraint; a `default` no longer in the set is dropped too.
    const changeEnum = (values: string[]) => {
        const nextDef = {...def}
        // antd tag tokens keep the separator's whitespace ("a, b" → ["a", " b"]), so trim, drop
        // blanks, coerce, and dedupe before storing.
        const coerced = Array.from(
            new Set(
                values
                    .map((v) => v.trim())
                    .filter((v) => v.length > 0)
                    .map((v) => coerceTo(v, type))
                    .filter((v): v is string | number => v !== null),
            ),
        )
        if (coerced.length) {
            nextDef.enum = coerced
            if (
                nextDef.default !== undefined &&
                !coerced.includes(nextDef.default as string | number)
            )
                delete nextDef.default
        } else {
            delete nextDef.enum
        }
        onChange(setNodeAt(schema, path, nextDef))
    }

    const changeDefault = (raw: string | undefined) => {
        const nextDef = {...def}
        const coerced = raw == null || raw === "" ? null : coerceTo(raw, type)
        if (coerced === null) delete nextDef.default
        else nextDef.default = coerced
        onChange(setNodeAt(schema, path, nextDef))
    }

    const changeItemType = (next: string) => {
        const items =
            next === "object" ? {type: "object", properties: {}, required: []} : {type: next}
        onChange(setNodeAt(schema, path, {...def, type: "array", items}))
    }

    const changeDescription = (value: string) => {
        const nextDef = {...def}
        if (value) nextDef.description = value
        else delete nextDef.description
        onChange(setNodeAt(schema, path, nextDef))
    }

    const required = isRequiredAt(schema, parent, key)
    const itemType = defType(itemsSchema(def))

    // A node that can hold child properties: an object, or an array whose items are objects.
    // Children live under the object itself, or under the array's `items`.
    const childContainerPath: Seg[] | null =
        type === "object"
            ? path
            : type === "array" && itemType === "object"
              ? [...path, {items: true}]
              : null
    const childCount = childContainerPath
        ? Object.keys(getProps(getNodeAt(schema, childContainerPath) ?? {})).length
        : 0

    const hint =
        type === "array"
            ? "Set item type to object to nest properties one level deeper."
            : type === "object"
              ? "This object groups nested properties."
              : "The value the model provides for this parameter."

    return (
        <div className="flex flex-col gap-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                Editing · {pathLabel(path)}
            </div>

            <div className="flex flex-col gap-3">
                <RailField label="Name" align="center">
                    <Input
                        className="font-mono"
                        value={nameLocal}
                        onChange={(e) => setNameLocal(e.target.value)}
                        onBlur={commitName}
                        onPressEnter={commitName}
                        placeholder="parameter_name"
                        disabled={disabled}
                    />
                </RailField>

                <RailField label="Type" align="center">
                    <div className={type === "array" ? "grid grid-cols-2 gap-2" : ""}>
                        <Select value={type} onValueChange={changeType} disabled={disabled}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                {TYPE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {type === "array" ? (
                            <Select
                                value={itemType}
                                onValueChange={changeItemType}
                                disabled={disabled}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select item type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {ITEM_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : null}
                    </div>
                </RailField>

                {isScalar ? (
                    <>
                        <RailField label="Allowed values">
                            <TagInput
                                className="w-full"
                                value={enumValues}
                                onChange={changeEnum}
                                separator={[",", "\n"]}
                                placeholder="Any value — add to restrict"
                                disabled={disabled}
                            />
                        </RailField>

                        <RailField label="Default" align="center">
                            {enumValues.length ? (
                                <Select
                                    value={defaultValue != null ? String(defaultValue) : ""}
                                    onValueChange={(v) => changeDefault(v || undefined)}
                                    disabled={disabled}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="No default" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {defaultValue != null && (
                                            <SelectItem value="">None</SelectItem>
                                        )}
                                        {enumValues.map((v) => (
                                            <SelectItem key={v} value={v}>
                                                {v}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    value={defaultValue != null ? String(defaultValue) : ""}
                                    onChange={(e) => changeDefault(e.target.value)}
                                    inputMode={type === "string" ? undefined : "decimal"}
                                    placeholder="No default"
                                    disabled={disabled}
                                />
                            )}
                        </RailField>
                    </>
                ) : null}

                <RailField label="Description">
                    <Input.TextArea
                        value={description}
                        onChange={(e) => changeDescription(e.target.value)}
                        autoSize={{minRows: 2, maxRows: 5}}
                        placeholder="What this parameter is for"
                        disabled={disabled}
                    />
                </RailField>

                <RailField label="Required" align="center">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={required}
                            onChange={(on) => onChange(toggleRequiredAt(schema, parent, key, on))}
                            disabled={disabled}
                        />
                        <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                            The model must provide this parameter on every call.
                        </span>
                    </div>
                </RailField>

                {childContainerPath ? (
                    <RailField label="Properties" align="center">
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={() => onAddChild(childContainerPath)}
                                disabled={disabled}
                                variant="outline"
                            >
                                {<Plus size={13} />}
                                Add property
                            </Button>
                            <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                                {childCount === 0
                                    ? "No nested properties yet."
                                    : `${childCount} nested ${
                                          childCount === 1 ? "property" : "properties"
                                      } — edit them in the tree.`}
                            </span>
                        </div>
                    </RailField>
                ) : null}
            </div>

            <p className="m-0 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                {hint}
            </p>

            {path.length > 3 ? (
                <p className="m-0 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                    Deeply nested — switch to JSON for full control over this structure.
                </p>
            ) : null}
        </div>
    )
}
