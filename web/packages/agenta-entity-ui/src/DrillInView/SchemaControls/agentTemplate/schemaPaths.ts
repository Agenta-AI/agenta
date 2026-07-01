/**
 * schemaPaths
 *
 * Pure, immutable JSON-Schema helpers for the tool-parameter master/detail editor. A node is
 * addressed by a `Seg[]` path from the root `parameters` object: `{p}` steps into an object
 * property, `{items:true}` steps into an array's `items`. The `{items:true}` sentinel (vs a bare
 * "items" string) avoids colliding with a property literally named "items".
 *
 * Every mutator returns a fresh schema; renames preserve property insertion order and remap the
 * `required` array. No React, no side effects — unit-testable in isolation.
 */

export type Schema = Record<string, unknown>

/** A property step (`.properties[p]`) or an array-items step (`.items`). */
export type Seg = {p: string} | {items: true}

export const TYPE_OPTIONS = [
    {value: "string", label: "string"},
    {value: "number", label: "number"},
    {value: "integer", label: "integer"},
    {value: "boolean", label: "boolean"},
    {value: "object", label: "object"},
    {value: "array", label: "array"},
]
// Array items: scalars + object (no array-of-array in the form — use JSON for that).
export const ITEM_TYPE_OPTIONS = TYPE_OPTIONS.filter((o) => o.value !== "array")

export function isRecord(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isItemsSeg(seg: Seg): seg is {items: true} {
    return "items" in seg
}

export function getProps(schema: Schema): Record<string, Schema> {
    return isRecord(schema.properties) ? (schema.properties as Record<string, Schema>) : {}
}

export function getRequired(schema: Schema): string[] {
    return Array.isArray(schema.required)
        ? (schema.required as unknown[]).filter((x): x is string => typeof x === "string")
        : []
}

export function defType(def: unknown): string {
    return isRecord(def) && typeof def.type === "string" ? def.type : "string"
}

/** An array's item schema (defaults to a string item). */
export function itemsSchema(def: Schema): Schema {
    return isRecord(def.items) ? (def.items as Schema) : {type: "string"}
}

export function buildObjectSchema(
    prev: Schema,
    properties: Record<string, Schema>,
    required: string[],
): Schema {
    return {
        ...prev,
        type: "object",
        properties,
        required,
        additionalProperties:
            isRecord(prev) && typeof prev.additionalProperties === "boolean"
                ? prev.additionalProperties
                : false,
    }
}

/** Resolve the schema node at `path`, or null if any step is missing. */
export function getNodeAt(root: Schema, path: Seg[]): Schema | null {
    let node: Schema | null = isRecord(root) ? root : null
    for (const seg of path) {
        if (!node) return null
        if (isItemsSeg(seg)) {
            node = isRecord(node.items) ? (node.items as Schema) : null
        } else {
            const props = getProps(node)
            node = isRecord(props[seg.p]) ? props[seg.p] : null
        }
    }
    return node
}

/** Immutably replace the node at `path` with `next` (rebuilding parents along the way). */
export function setNodeAt(root: Schema, path: Seg[], next: Schema): Schema {
    if (path.length === 0) return next
    const [seg, ...rest] = path
    if (isItemsSeg(seg)) {
        const items = isRecord(root.items) ? (root.items as Schema) : {type: "string"}
        return {...root, type: "array", items: setNodeAt(items, rest, next)}
    }
    const props = getProps(root)
    const child = isRecord(props[seg.p]) ? props[seg.p] : {type: "string"}
    return buildObjectSchema(
        root,
        {...props, [seg.p]: setNodeAt(child, rest, next)},
        getRequired(root),
    )
}

/** Rename the property `key` under the object at `parentPath`, preserving order + `required`. */
export function renamePropertyAt(
    root: Schema,
    parentPath: Seg[],
    key: string,
    nextKey: string,
): Schema {
    const parent = getNodeAt(root, parentPath)
    if (!parent) return root
    const props = getProps(parent)
    if (!nextKey || nextKey === key || props[nextKey]) return root
    const nextProps: Record<string, Schema> = {}
    for (const [k, v] of Object.entries(props)) nextProps[k === key ? nextKey : k] = v
    const nextRequired = getRequired(parent).map((r) => (r === key ? nextKey : r))
    return setNodeAt(root, parentPath, buildObjectSchema(parent, nextProps, nextRequired))
}

/** Append a fresh `string` property under the object at `parentPath`; returns the new schema + key. */
export function addPropertyAt(root: Schema, parentPath: Seg[]): {schema: Schema; key: string} {
    const parent = getNodeAt(root, parentPath) ?? {type: "object", properties: {}, required: []}
    const props = getProps(parent)
    let i = Object.keys(props).length + 1
    let key = `param${i}`
    while (props[key]) key = `param${++i}`
    const nextParent = buildObjectSchema(
        parent,
        {...props, [key]: {type: "string"}},
        getRequired(parent),
    )
    return {schema: setNodeAt(root, parentPath, nextParent), key}
}

/** Remove the property `key` from the object at `parentPath` (drops it from `required` too). */
export function removeNodeAt(root: Schema, parentPath: Seg[], key: string): Schema {
    const parent = getNodeAt(root, parentPath)
    if (!parent) return root
    const nextProps = {...getProps(parent)}
    delete nextProps[key]
    return setNodeAt(
        root,
        parentPath,
        buildObjectSchema(
            parent,
            nextProps,
            getRequired(parent).filter((r) => r !== key),
        ),
    )
}

/** Toggle whether `key` is required on the object at `parentPath`. */
export function toggleRequiredAt(
    root: Schema,
    parentPath: Seg[],
    key: string,
    on: boolean,
): Schema {
    const parent = getNodeAt(root, parentPath)
    if (!parent) return root
    const required = getRequired(parent)
    const nextRequired = on
        ? Array.from(new Set([...required, key]))
        : required.filter((r) => r !== key)
    return setNodeAt(root, parentPath, buildObjectSchema(parent, getProps(parent), nextRequired))
}

/** Whether the property `key` under the object at `parentPath` is required. */
export function isRequiredAt(root: Schema, parentPath: Seg[], key: string): boolean {
    const parent = getNodeAt(root, parentPath)
    return parent ? getRequired(parent).includes(key) : false
}

/** The trailing property key of a path (the leaf's own name), or null for the root / an items leaf. */
export function leafKey(path: Seg[]): string | null {
    const last = path[path.length - 1]
    return last && !isItemsSeg(last) ? last.p : null
}

/** The path to a leaf's parent object (drops the trailing property step). */
export function parentPath(path: Seg[]): Seg[] {
    return path.slice(0, -1)
}

/** Uppercase dotted breadcrumb for the detail header, e.g. `FILTERS.SOURCES` (items → `[ ]`). */
export function pathLabel(path: Seg[]): string {
    return path.map((seg) => (isItemsSeg(seg) ? "[ ]" : seg.p.toUpperCase())).join(" · ")
}

/** Serialize a path to a stable string for selection equality (`p:key` / `items`). */
export function pathKey(path: Seg[]): string {
    return path.map((seg) => (isItemsSeg(seg) ? "[]" : `p:${seg.p}`)).join("/")
}
