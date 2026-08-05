/**
 * SchemaTree
 *
 * Read-only, recursive JSON-schema viewer: each property renders name (mono) · type ·
 * required|optional, with an optional muted description line, and nested object/array-of-object
 * fields indent under a left guide line. Distinct from the EDITABLE `ParameterTree` — this
 * one never mutates. Containment (max-height + scroll) is the caller's job so it can size the
 * section body.
 *
 * Styling uses antd semantic tokens (`--ag-color*`) + antd `Tag` only — dark-safe.
 */
import {Tag} from "antd"

export interface SchemaTreeProps {
    /** A JSON-schema object node (`{type:"object", properties, required}`). */
    schema: Record<string, unknown> | null | undefined
    /** Shown when the schema declares no properties. */
    emptyText?: string
    className?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function typeLabel(def: Record<string, unknown>): string {
    const t = def.type
    if (t === "array") {
        const items = isRecord(def.items) ? def.items : null
        const itemType = items && typeof items.type === "string" ? items.type : null
        return itemType ? `array<${itemType}>` : "array"
    }
    if (Array.isArray(t)) {
        const parts = t.filter((x): x is string => typeof x === "string")
        return parts.length ? parts.join(" | ") : "any"
    }
    if (typeof t === "string") return t
    return "any"
}

// The nested object schema to recurse into: an object's own props, or an array-of-objects' items.
function childSchema(def: Record<string, unknown>): Record<string, unknown> | null {
    if (def.type === "object" && isRecord(def.properties)) return def
    if (def.type === "array" && isRecord(def.items)) {
        const items = def.items
        if (items.type === "object" && isRecord(items.properties)) return items
    }
    return null
}

function SchemaRows({node, depth}: {node: Record<string, unknown>; depth: number}) {
    const props = isRecord(node.properties) ? node.properties : {}
    const required = Array.isArray(node.required) ? (node.required as unknown[]) : []
    const entries = Object.entries(props)
    if (entries.length === 0) return null

    return (
        <div
            className={
                depth > 0
                    ? "flex flex-col border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3"
                    : "flex flex-col"
            }
        >
            {entries.map(([name, rawDef]) => {
                const def = isRecord(rawDef) ? rawDef : {}
                const child = childSchema(def)
                const description = typeof def.description === "string" ? def.description : ""
                return (
                    <div key={name} className="py-1.5">
                        <div className="flex items-baseline gap-2">
                            <span className="font-mono text-xs text-[var(--ag-colorText)]">
                                {name}
                            </span>
                            <span className="text-[11px] text-[var(--ag-colorTextSecondary)]">
                                {typeLabel(def)}
                            </span>
                            {required.includes(name) ? (
                                <Tag
                                    color="red"
                                    bordered={false}
                                    className="m-0 px-1.5 py-0 text-[10px] leading-[18px]"
                                >
                                    required
                                </Tag>
                            ) : (
                                <span className="text-[10px] text-[var(--ag-colorTextTertiary)]">
                                    optional
                                </span>
                            )}
                        </div>
                        {description ? (
                            <p className="m-0 mt-0.5 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                {description}
                            </p>
                        ) : null}
                        {child ? (
                            <div className="mt-1">
                                <SchemaRows node={child} depth={depth + 1} />
                            </div>
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}

export function SchemaTree({schema, emptyText = "No declared fields", className}: SchemaTreeProps) {
    const node = isRecord(schema) ? schema : null
    const props = node && isRecord(node.properties) ? node.properties : {}
    const description = typeof node?.description === "string" ? node.description : ""

    if (Object.keys(props).length === 0) {
        return (
            <div className={`text-[11px] text-[var(--ag-colorTextTertiary)] ${className ?? ""}`}>
                {emptyText}
            </div>
        )
    }

    return (
        <div className={className}>
            {description ? (
                <p className="m-0 mb-1.5 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                    {description}
                </p>
            ) : null}
            <SchemaRows node={node as Record<string, unknown>} depth={0} />
        </div>
    )
}
