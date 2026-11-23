/**
 * ParameterTree
 *
 * The left rail of the tool-parameter master/detail editor: a selectable, nesting tree of a
 * function tool's JSON-Schema `parameters`. `+ Add` (header) appends a root property; object nodes
 * expand to their child properties with a `+ Add property` affordance; array-of-object nodes recurse
 * through an `items` group; scalar arrays show a muted `items: <type>` leaf. The active row is
 * primary-tinted and each row hover-reveals a remove affordance (shared `RowRemoveButton`).
 *
 * Pure presentation over the schema — all mutation is delegated to the host via callbacks; expansion
 * is the only local state (auto-opened along the selected path). Dark-safe (`--ag-color*` tokens).
 */
import {useEffect, useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import parameterEditorCatalog from "@agenta/i18n/catalogs/entityUi.parameterEditor"
import {Button} from "@agenta/ui/ui"
import {CaretDown, CaretRight, Plus, Wrench} from "@phosphor-icons/react"

import {RowRemoveButton} from "../../../drawers/shared/RowRemoveButton"

import {
    defType,
    getProps,
    getRequired,
    isRecord,
    itemsSchema,
    pathKey,
    type Schema,
    type Seg,
} from "./schemaPaths"

export interface ParameterTreeProps {
    /** The function tool's `parameters` object schema. */
    schema: Schema
    /** Currently selected node path (null = the meta row is active). */
    selectedPath: Seg[] | null
    onSelect: (path: Seg[]) => void
    /** Whether the pinned "Tool details" row is the active selection (nothing else selected). */
    metaSelected: boolean
    /** Select the pinned "Tool details" row → return to editing the tool's name/description/permission. */
    onSelectMeta: () => void
    /** Append a root-level property (host adds it + selects the new key). */
    onAddRoot: () => void
    /** Append a child property under the object at `parentPath`. */
    onAddProperty: (parentPath: Seg[]) => void
    /** Remove property `key` from the object at `parentPath`. */
    onRemove: (parentPath: Seg[], key: string) => void
    disabled?: boolean
}

const TYPE_TINT = "text-muted-foreground"

// The nested object a node expands into: an object's own props, or an array-of-object's items.
function expandableChild(def: Schema): Schema | null {
    const type = defType(def)
    if (type === "object") return def
    if (type === "array" && defType(itemsSchema(def)) === "object") return itemsSchema(def)
    return null
}

function typeLabel(def: Schema): string {
    const type = defType(def)
    if (type === "array") return `array<${defType(itemsSchema(def))}>`
    return type
}

function LeadingGlyph({type}: {type: string}) {
    if (type === "array") {
        return <span className={` text-code-sm ${TYPE_TINT}`}>[ ]</span>
    }
    // Scalar: a small hollow dot.
    return (
        <span className="h-1.5 w-1.5 rounded-sm border border-solid border-border-strong" />
    )
}

function AddPropertyRow({
    onClick,
    disabled,
    label,
}: {
    onClick: () => void
    disabled?: boolean
    label: string
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="flex w-full cursor-pointer appearance-none items-center gap-1 rounded border-0 bg-transparent px-2 py-1 text-left text-label text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
            <Plus size={12} />
            {label}
        </button>
    )
}

function TreeRow({
    name,
    def,
    path,
    required,
    expandable,
    expanded,
    active,
    onToggle,
    onSelect,
    onRemove,
    disabled,
}: {
    name: string
    def: Schema
    path: Seg[]
    required: boolean
    expandable: boolean
    expanded: boolean
    active: boolean
    onToggle: () => void
    onSelect: () => void
    onRemove: () => void
    disabled?: boolean
}) {
    const t = useT(parameterEditorCatalog)
    return (
        <div
            className={`group flex items-center gap-1 rounded px-1.5 py-1 ${
                active ? "bg-selected" : "hover:bg-accent"
            }`}
        >
            {expandable ? (
                <button
                    type="button"
                    aria-label={
                        expanded
                            ? t("entityUi.parameterEditor.collapse")
                            : t("entityUi.parameterEditor.expand")
                    }
                    onClick={(e) => {
                        e.stopPropagation()
                        onToggle()
                    }}
                    className="flex h-4 w-4 shrink-0 cursor-pointer appearance-none items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                >
                    {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </button>
            ) : (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <LeadingGlyph type={defType(def)} />
                </span>
            )}

            <button
                type="button"
                onClick={onSelect}
                className="flex min-w-0 flex-1 cursor-pointer appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left"
            >
                <span
                    className={`truncate text-code-sm ${
                        active ? "text-primary" : "text-foreground"
                    }`}
                >
                    {name}
                </span>
                {required ? (
                    <span
                        className="h-1.5 w-1.5 shrink-0 rounded-sm bg-destructive"
                        title={t("entityUi.parameterEditor.required")}
                    />
                ) : null}
                <span className={`ml-auto shrink-0 pl-2 text-meta ${TYPE_TINT}`}>
                    {typeLabel(def)}
                </span>
            </button>

            {!disabled ? <RowRemoveButton onRemove={onRemove} /> : null}
        </div>
    )
}

function TreeNodes({
    node,
    basePath,
    selectedKey,
    expanded,
    toggle,
    onSelect,
    onAddProperty,
    onRemove,
    disabled,
}: {
    node: Schema
    basePath: Seg[]
    selectedKey: string | null
    expanded: Set<string>
    toggle: (key: string) => void
    onSelect: (path: Seg[]) => void
    onAddProperty: (parentPath: Seg[]) => void
    onRemove: (parentPath: Seg[], key: string) => void
    disabled?: boolean
}) {
    const t = useT(parameterEditorCatalog)
    const props = getProps(node)
    const required = getRequired(node)
    const entries = Object.entries(props)

    return (
        <div className="flex flex-col gap-0.5">
            {entries.map(([key, rawDef]) => {
                const def = isRecord(rawDef) ? rawDef : {type: "string"}
                const path = [...basePath, {p: key}]
                const key$ = pathKey(path)
                const child = expandableChild(def)
                const isExpandable = child != null
                const isExpanded = isExpandable && expanded.has(key$)
                const type = defType(def)
                const scalarArray = type === "array" && !child

                return (
                    <div key={key}>
                        <TreeRow
                            name={key}
                            def={def}
                            path={path}
                            required={required.includes(key)}
                            expandable={isExpandable}
                            expanded={isExpanded}
                            active={selectedKey === key$}
                            onToggle={() => toggle(key$)}
                            onSelect={() => onSelect(path)}
                            onRemove={() => onRemove(basePath, key)}
                            disabled={disabled}
                        />

                        {scalarArray ? (
                            <div className="ml-3 border-0 border-l border-solid border-border-muted pl-3">
                                <span className="block px-1.5 py-1 text-code-sm text-muted-foreground">
                                    items: {defType(itemsSchema(def))}
                                </span>
                            </div>
                        ) : null}

                        {isExpanded && child ? (
                            <div className="ml-3 border-0 border-l border-solid border-border-muted pl-3">
                                <TreeNodes
                                    node={child}
                                    basePath={type === "array" ? [...path, {items: true}] : path}
                                    selectedKey={selectedKey}
                                    expanded={expanded}
                                    toggle={toggle}
                                    onSelect={onSelect}
                                    onAddProperty={onAddProperty}
                                    onRemove={onRemove}
                                    disabled={disabled}
                                />
                                {!disabled ? (
                                    <AddPropertyRow
                                        label={t("entityUi.parameterEditor.addProperty")}
                                        onClick={() =>
                                            onAddProperty(
                                                type === "array" ? [...path, {items: true}] : path,
                                            )
                                        }
                                    />
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}

export function ParameterTree({
    schema,
    selectedPath,
    onSelect,
    metaSelected,
    onSelectMeta,
    onAddRoot,
    onAddProperty,
    onRemove,
    disabled,
}: ParameterTreeProps) {
    const t = useT(parameterEditorCatalog)
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const selectedKey = selectedPath ? pathKey(selectedPath) : null

    // Keep every ancestor of the selected node open, so adding/selecting deep never hides it.
    useEffect(() => {
        if (!selectedPath || selectedPath.length < 2) return
        setExpanded((prev) => {
            const next = new Set(prev)
            for (let i = 1; i < selectedPath.length; i++)
                next.add(pathKey(selectedPath.slice(0, i)))
            return next
        })
    }, [selectedKey, selectedPath])

    const toggle = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })

    const rootProps = useMemo(() => getProps(schema), [schema])
    const isEmpty = Object.keys(rootProps).length === 0

    return (
        <div className="ag-drawer-rail flex w-[144px] shrink-0 flex-col overflow-hidden border-0 border-r border-solid border-border-muted sm:w-[240px]">
            {/* Pinned meta row — always reachable so property editing never traps you. */}
            <div className="shrink-0 border-0 border-b border-solid border-border-muted px-2 pb-2 pt-3">
                <button
                    type="button"
                    onClick={onSelectMeta}
                    className={`flex w-full cursor-pointer appearance-none items-center gap-2 rounded border-0 px-1.5 py-1.5 text-left ${
                        metaSelected
                            ? "bg-selected"
                            : "bg-transparent hover:bg-accent"
                    }`}
                >
                    <Wrench
                        size={14}
                        className={`shrink-0 ${
                            metaSelected
                                ? "text-primary"
                                : "text-muted-foreground"
                        }`}
                    />
                    <span
                        className={`truncate text-label ${
                            metaSelected
                                ? "font-medium text-primary"
                                : "text-foreground"
                        }`}
                    >
                        {t("entityUi.parameterEditor.toolDetails")}
                    </span>
                </button>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
                <span className="text-meta font-medium text-muted-foreground">
                    {t("entityUi.parameterEditor.parameters")}
                </span>
                <Button
                    variant="link"
                    className="h-auto p-0"
                    onClick={onAddRoot}
                    disabled={disabled}
                >
                    <Plus size={13} />
                    {t("entityUi.parameterEditor.add")}
                </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {isEmpty ? (
                    <p className="m-0 px-1.5 py-2 text-meta leading-snug text-muted-foreground">
                        {t("entityUi.parameterEditor.noParameters")}
                    </p>
                ) : (
                    <TreeNodes
                        node={schema}
                        basePath={[]}
                        selectedKey={selectedKey}
                        expanded={expanded}
                        toggle={toggle}
                        onSelect={onSelect}
                        onAddProperty={onAddProperty}
                        onRemove={onRemove}
                        disabled={disabled}
                    />
                )}
            </div>
        </div>
    )
}
