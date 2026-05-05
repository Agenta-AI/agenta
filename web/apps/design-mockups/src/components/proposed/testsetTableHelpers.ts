/**
 * testsetTableHelpers — minimal entity-layer simulation for the
 * solutions-tables mid-fidelity demo.
 *
 * Production's testcase entity (web/oss/src/state/entities/testcase/) does
 * three things relevant here:
 *   1. Compute the union of column keys across all rows in the testset.
 *   2. Expand homogeneous nested objects into dotted-key columns marked
 *      with `parentKey` (so groupColumns() can group them under a header).
 *   3. Flatten each row into a Record<columnKey, value> table-row format.
 *
 * This file replicates just enough of that to drive an antd Table without
 * needing the entity atom layer. For the production rendering path, the
 * entity layer is the source of truth — these helpers are mockup-only.
 */

import type {Column} from "@/oss/state/entities/testcase/columnState"

/** A column that came from object expansion — `parentKey` triggers grouping. */
export interface ExpandedColumn extends Column {
    parentKey?: string
}

/** A row in the stub testset, indexed by id. */
export interface StubRow {
    id: string
    label: string
    data: Record<string, unknown>
}

/** Flat row format for the antd table — each key maps to a column. */
export type FlatRow = {
    id: string
    label: string
    /**
     * Original nested row data, preserved so collapsed-group cell renderers
     * can walk a dotted path (e.g. show the full `geo.coordinates` subtree
     * for a collapsed `geo > coordinates` group). Flat columns still live as
     * top-level keys on the row for the antd Table dataIndex lookup.
     */
    _data: Record<string, unknown>
    /** Flat column values — string keys, including dotted-path leaves. */
    [columnKey: string]: unknown
}

/**
 * Walk a dotted path through nested objects on a row's data, returning the
 * deepest value (or `undefined` if any step is missing / non-object).
 *
 * If a string is encountered mid-traversal AND it parses as a JSON object,
 * the parsed value is used to continue. This is what makes parsed-stringified
 * columns (gap-02 parse-on-detect) traversable without restructuring the
 * source data — the expansion happens lazily here. Callers who don't want
 * this auto-parse behavior should walk segments manually.
 */
export function getNestedValue(data: unknown, segments: string[]): unknown {
    let v: unknown = data
    for (const seg of segments) {
        if (v === null || v === undefined) return undefined
        // Auto-parse stringified-JSON values mid-traversal so parsed-
        // stringified columns can drill in without restructuring.
        if (typeof v === "string") {
            const parsed = tryParseAsObject(v)
            if (parsed !== null) {
                v = parsed
            } else {
                return undefined
            }
        }
        if (typeof v !== "object" || Array.isArray(v)) return undefined
        v = (v as Record<string, unknown>)[seg]
    }
    return v
}

/**
 * Try to parse a string as a homogeneous JSON object. Returns the parsed
 * object on success, null otherwise. Used by both column-detection and
 * runtime traversal.
 */
function tryParseAsObject(s: string): Record<string, unknown> | null {
    if (s.length < 2) return null
    const first = s[0]
    if (first !== "{") return null
    try {
        const parsed = JSON.parse(s)
        if (
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {
            return parsed as Record<string, unknown>
        }
    } catch {
        // not parseable
    }
    return null
}

/**
 * Detect top-level columns whose values across rows are all strings that
 * parse as homogeneous JSON objects. These are the gap-02 parse-on-detect
 * candidates — the user can opt-in to expand them into sub-columns the
 * same way homogeneous-object columns expand. Returns the set of top-level
 * keys eligible for stringified expansion.
 *
 * Rule (mirrors `shouldExpandValueAcrossRows` for objects): at least 2
 * rows must have parseable values, and every parsed value must share at
 * least one sub-key with the first one.
 */
export function detectStringifiedExpandableColumns(
    rows: StubRow[],
): Set<string> {
    const result = new Set<string>()
    const topLevelKeys = new Set<string>()
    for (const row of rows) {
        for (const k of Object.keys(row.data)) topLevelKeys.add(k)
    }

    for (const key of topLevelKeys) {
        const parsedObjects: Record<string, unknown>[] = []
        let allParseable = true
        for (const row of rows) {
            const v = row.data[key]
            if (v === undefined) continue // missing on this row — skip
            if (typeof v !== "string") {
                allParseable = false
                break
            }
            const parsed = tryParseAsObject(v)
            if (parsed === null || Object.keys(parsed).length === 0) {
                allParseable = false
                break
            }
            parsedObjects.push(parsed)
        }
        if (!allParseable || parsedObjects.length < 2) continue
        const firstKeys = new Set(Object.keys(parsedObjects[0]))
        const homogeneous = parsedObjects.every((p) =>
            Object.keys(p).some((k) => firstKeys.has(k)),
        )
        if (homogeneous) result.add(key)
    }
    return result
}

/**
 * Decide whether the value at the given dotted path should expand into
 * sub-columns across the testset. Production rule: expand when the value
 * is a homogeneous object (plain object, not array, with overlapping
 * sub-keys across at least 2 rows). Walks the same path on every row.
 *
 * Imperfect but matches production's visible behavior: `inputs` / `outputs`
 * / `geo` / `geo.coordinates` get expanded; `metadata` (mixed shapes per
 * row) doesn't.
 */
function shouldExpandValueAcrossRows(
    rows: StubRow[],
    segments: string[],
): boolean {
    const objectValues = rows
        .map((r) => getNestedValue(r.data, segments))
        .filter(
            (v): v is Record<string, unknown> =>
                v !== null &&
                typeof v === "object" &&
                !Array.isArray(v) &&
                Object.keys(v as object).length > 0,
        )
    if (objectValues.length < 2) return false
    // Cheap homogeneity check: every row's object shares at least one key
    // with the first row's object.
    const firstKeys = new Set(Object.keys(objectValues[0]))
    return objectValues.every((v) =>
        Object.keys(v).some((k) => firstKeys.has(k)),
    )
}

/** Cap on dotted-path depth — beyond this, leaves render as JSON in cells. */
const MAX_EXPAND_DEPTH = 5

/**
 * Recursively expand a path into leaf columns. If the value at the path is
 * a homogeneous object and we're under the depth cap, recurse; otherwise
 * emit a single leaf column at the path. `parentKey` is set on every
 * expanded column so production's groupColumns recognizes it as expanded
 * (not a literal-dot key).
 */
function expandRecursive(
    rows: StubRow[],
    segments: string[],
    rootKey: string,
): ExpandedColumn[] {
    if (
        segments.length >= MAX_EXPAND_DEPTH ||
        !shouldExpandValueAcrossRows(rows, segments)
    ) {
        return [
            {
                key: segments.join("."),
                name: segments[segments.length - 1],
                parentKey: rootKey,
            },
        ]
    }

    const subKeys = new Set<string>()
    for (const row of rows) {
        const v = getNestedValue(row.data, segments)
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            for (const k of Object.keys(v as object)) subKeys.add(k)
        }
    }

    const columns: ExpandedColumn[] = []
    for (const subKey of subKeys) {
        columns.push(...expandRecursive(rows, [...segments, subKey], rootKey))
    }
    return columns
}

/**
 * Compute the column union across rows. Top-level columns are union'd; if
 * a top-level column is a homogeneous object, expand recursively (up to
 * MAX_EXPAND_DEPTH) into dotted-key leaf columns marked with `parentKey`.
 *
 * For the kitchen-sink Vanuatu fixture this produces e.g. `geo.region`,
 * `geo.subregion`, `geo.coordinates.lat`, `geo.coordinates.lng`,
 * `geo.coordinates.altitude_m` — three levels deep, so groupColumns can
 * render `geo > coordinates > lat / lng / altitude_m` as nested groups.
 *
 * When `parsedStringified` includes a top-level key, that column's value
 * (a stringified JSON object) is parsed across rows and expanded the same
 * way homogeneous-object columns are. Used for gap-02 parse-on-detect:
 * the user toggles a column to "parsed" via the [json-str] chip and the
 * column becomes a group with sub-columns drawn from the parsed payload.
 * `getNestedValue`'s mid-traversal string parsing makes the value lookup
 * work transparently in `flattenRow` — no restructuring of source data.
 */
export function computeColumns(
    rows: StubRow[],
    parsedStringified?: Set<string>,
): ExpandedColumn[] {
    const topLevelKeys = new Set<string>()
    for (const row of rows) {
        for (const k of Object.keys(row.data)) {
            topLevelKeys.add(k)
        }
    }

    const columns: ExpandedColumn[] = []
    for (const key of topLevelKeys) {
        if (shouldExpandValueAcrossRows(rows, [key])) {
            columns.push(...expandRecursive(rows, [key], key))
        } else if (
            parsedStringified?.has(key) &&
            shouldExpandStringifiedAcrossRows(rows, [key])
        ) {
            // Parsed stringified column — first level is a one-shot parse
            // (the row's value is a string, not an object, so the normal
            // `shouldExpandValueAcrossRows` gate would say "no expand" at
            // depth 0). After the first parse, deeper levels fall back to
            // the standard expansion via `expandRecursive` because
            // `getNestedValue` auto-parses strings mid-traversal.
            columns.push(...expandStringifiedFirstLevel(rows, [key], key))
        } else {
            columns.push({key, name: key})
        }
    }
    return columns
}

/**
 * One-shot expansion for parsed stringified columns: parse the string at
 * the given path on every row, union the sub-keys, and emit sub-columns.
 * For each sub-column, defer to normal `expandRecursive` so that nested
 * objects inside the parsed payload also expand (getNestedValue's mid-
 * traversal string parsing makes this work).
 */
function expandStringifiedFirstLevel(
    rows: StubRow[],
    segments: string[],
    rootKey: string,
): ExpandedColumn[] {
    const subKeys = new Set<string>()
    for (const row of rows) {
        // Walk to the string leaf without auto-parse (raw lookup).
        let v: unknown = row.data
        for (const seg of segments) {
            if (
                v &&
                typeof v === "object" &&
                !Array.isArray(v)
            ) {
                v = (v as Record<string, unknown>)[seg]
            } else {
                v = undefined
                break
            }
        }
        if (typeof v === "string") {
            const parsed = tryParseAsObject(v)
            if (parsed) {
                for (const k of Object.keys(parsed)) subKeys.add(k)
            }
        }
    }

    const columns: ExpandedColumn[] = []
    for (const subKey of subKeys) {
        const newSegments = [...segments, subKey]
        if (
            newSegments.length >= MAX_EXPAND_DEPTH ||
            !shouldExpandValueAcrossRows(rows, newSegments)
        ) {
            // Leaf — no further expansion.
            columns.push({
                key: newSegments.join("."),
                name: subKey,
                parentKey: rootKey,
            })
        } else {
            // Object value at this level — recurse normally; getNestedValue
            // auto-parses any remaining stringified hops.
            columns.push(...expandRecursive(rows, newSegments, rootKey))
        }
    }
    return columns
}

/**
 * Like `shouldExpandValueAcrossRows`, but for the stringified case — at
 * the given path, the value should be a string that parses to a homogeneous
 * object across rows. Used to gate parsed-stringified expansion in
 * `computeColumns` so we don't accidentally recurse into a column the
 * user opted-in to but whose payload turns out to be heterogeneous.
 */
function shouldExpandStringifiedAcrossRows(
    rows: StubRow[],
    segments: string[],
): boolean {
    const parsedObjects: Record<string, unknown>[] = []
    for (const row of rows) {
        // Walk the path manually (without auto-parse) to find the string at
        // the leaf, then parse it.
        let v: unknown = row.data
        for (const seg of segments) {
            if (
                v &&
                typeof v === "object" &&
                !Array.isArray(v)
            ) {
                v = (v as Record<string, unknown>)[seg]
            } else {
                v = undefined
                break
            }
        }
        if (typeof v !== "string") continue
        const parsed = tryParseAsObject(v)
        if (parsed && Object.keys(parsed).length > 0) {
            parsedObjects.push(parsed)
        }
    }
    if (parsedObjects.length < 2) return false
    const firstKeys = new Set(Object.keys(parsedObjects[0]))
    return parsedObjects.every((p) =>
        Object.keys(p).some((k) => firstKeys.has(k)),
    )
}

/**
 * Flatten a stub row into the table-row shape: { id, label, [columnKey]: value }.
 * Expanded columns walk the full dotted path through nested objects (so
 * `geo.coordinates.lat` reads `row.data.geo.coordinates.lat`). Flat columns
 * read the top-level value as-is (a key like `geo.region` literal stays
 * intact). Missing keys produce `undefined` so the cell renderer can
 * decide between "—" (missing) and "" (empty string).
 */
export function flattenRow(row: StubRow, columns: ExpandedColumn[]): FlatRow {
    const out: FlatRow = {id: row.id, label: row.label, _data: row.data}
    for (const col of columns) {
        if (col.parentKey) {
            // Expanded column — walk the full dotted path.
            out[col.key] = getNestedValue(row.data, col.key.split("."))
        } else {
            // Flat top-level column — keys with dots in their names (gap-05
            // literal-dot keys) stay intact and are not traversed.
            out[col.key] = row.data[col.key]
        }
    }
    return out
}

/**
 * Detect mixed-type columns: column has heterogeneous types across rows
 * (e.g. string in one row, object in another). Used for the gap-02 [mixed]
 * chip on the column header.
 */
export function detectMixedColumns(
    rows: FlatRow[],
    columns: ExpandedColumn[],
): Set<string> {
    const mixed = new Set<string>()
    for (const col of columns) {
        const types = new Set<string>()
        for (const row of rows) {
            const v = row[col.key]
            if (v === undefined || v === null) continue
            if (Array.isArray(v)) types.add("array")
            else types.add(typeof v)
            if (types.size > 1) {
                mixed.add(col.key)
                break
            }
        }
    }
    return mixed
}

/**
 * Detect dot-key collision columns — when the same row has both a literal
 * dotted key (e.g. `"geo.region"`) AND a nested key whose path matches
 * (e.g. `geo.region` via the `geo` object's `region` property). Returns
 * the set of column keys involved (both the literal and the nested side).
 */
export function detectCollisionColumns(
    rows: StubRow[],
    columns: ExpandedColumn[],
): Set<string> {
    const collisions = new Set<string>()
    for (const row of rows) {
        // Top-level keys with a dot in the name (literal-dotted).
        const dotted = Object.keys(row.data).filter((k) => k.includes("."))
        for (const literal of dotted) {
            const head = literal.split(".")[0]
            const headValue = row.data[head]
            if (
                headValue !== null &&
                typeof headValue === "object" &&
                !Array.isArray(headValue)
            ) {
                // The first segment is also an object key — collision possible.
                collisions.add(literal)
                // Also flag any expanded sub-column under that head.
                for (const col of columns) {
                    if (col.parentKey === head) {
                        collisions.add(col.key)
                    }
                }
            }
        }
    }
    return collisions
}

/**
 * Detect literal-dotted-key columns — top-level keys whose name contains
 * a dot (gap-05 [dotted-key] chip). NOT the same as expanded dotted-key
 * sub-columns (those have `parentKey`).
 */
export function detectDottedKeyColumns(columns: ExpandedColumn[]): Set<string> {
    const dotted = new Set<string>()
    for (const col of columns) {
        if (!col.parentKey && col.key.includes(".")) {
            dotted.add(col.key)
        }
    }
    return dotted
}

/**
 * Column-level type — the dominant type for a column across all rows.
 * Returns the chip variant string the column header should display when
 * gap-01 chip-mode is "all" and the column is NOT mixed.
 *
 * Logic: scan rows for non-null/non-missing values; if every observed value
 * shares one type, return that type. If a column is heterogeneous (mixed),
 * the caller already has `detectMixedColumns` for that — return null here.
 *
 * Returns BOTH axes per column (refactor 2026-05-05 per JP feedback):
 *   - `type` — the JSON primitive (str / num / bool / null / obj / arr)
 *   - `hint` — optional render hint (messages / tool-calls / stringified)
 *
 * Caller emits both chips: `[arr] [messages]`, `[str] [stringified]`, etc.
 */
export type ColumnTypePrimitive =
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "json-object"
    | "json-array"

export type ColumnRenderHint = "messages" | "tool-calls" | "stringified"

export interface ColumnTypeInfo {
    type: ColumnTypePrimitive
    hint: ColumnRenderHint | null
}

/** @deprecated Use ColumnTypePrimitive | ColumnRenderHint instead. */
export type ColumnTypeChip = ColumnTypePrimitive

const TOOL_CALL_KEYS = new Set(["id", "type", "function"])

function isMessagesArrayValue(arr: unknown[]): boolean {
    return (
        arr.length > 0 &&
        arr.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                "role" in (item as object) &&
                ("content" in (item as object) ||
                    "tool_calls" in (item as object)),
        )
    )
}

function isToolCallArrayValue(arr: unknown[]): boolean {
    return (
        arr.length > 0 &&
        arr.every(
            (item) =>
                item != null &&
                typeof item === "object" &&
                Object.keys(item as object).every((k) => TOOL_CALL_KEYS.has(k)) &&
                (item as {type?: unknown}).type === "function",
        )
    )
}

function looksLikeStringifiedJson(s: string): boolean {
    if (s.length < 2) return false
    const first = s[0]
    if (first !== "{" && first !== "[") return false
    try {
        JSON.parse(s)
        return true
    } catch {
        return false
    }
}

export function detectColumnTypes(
    rows: FlatRow[],
    columns: ExpandedColumn[],
    mixed: Set<string>,
): Map<string, ColumnTypeInfo> {
    const result = new Map<string, ColumnTypeInfo>()
    for (const col of columns) {
        if (mixed.has(col.key)) continue
        let observedType: ColumnTypePrimitive | null = null
        let observedHint: ColumnRenderHint | null = null
        let sawAnyValue = false
        let allStringsAreStringified = true
        let sawAnyString = false
        for (const row of rows) {
            const v = row[col.key]
            if (v === undefined) continue
            sawAnyValue = true
            let nextType: ColumnTypePrimitive
            let nextHint: ColumnRenderHint | null = null
            if (v === null) {
                nextType = "null"
            } else if (Array.isArray(v)) {
                nextType = "json-array"
                if (isMessagesArrayValue(v)) nextHint = "messages"
                else if (isToolCallArrayValue(v)) nextHint = "tool-calls"
            } else if (typeof v === "object") {
                nextType = "json-object"
            } else if (typeof v === "string") {
                sawAnyString = true
                nextType = "string"
                if (!looksLikeStringifiedJson(v)) {
                    allStringsAreStringified = false
                }
            } else if (typeof v === "number") {
                nextType = "number"
            } else if (typeof v === "boolean") {
                nextType = "boolean"
            } else {
                continue
            }
            if (observedType === null) {
                observedType = nextType
                observedHint = nextHint
            } else if (observedType === "null" && nextType !== "null") {
                // Nulls are noise — let the first concrete type win.
                observedType = nextType
                observedHint = nextHint
            } else if (observedType !== nextType && nextType !== "null") {
                // Multi-type but not in `mixed` — should not happen since
                // mixed detection already excluded these; bail out.
                observedType = null
                observedHint = null
                break
            } else if (observedHint !== nextHint && nextType !== "null") {
                // Same type but inconsistent render hints across rows
                // (e.g. one row's array is messages, another isn't) — drop
                // the hint to avoid claiming uniformity that doesn't hold.
                observedHint = null
            }
        }
        // Promote `string` → `string + stringified` if every observed string
        // parses as JSON. The render hint stacks alongside the type chip.
        if (
            sawAnyValue &&
            observedType === "string" &&
            sawAnyString &&
            allStringsAreStringified
        ) {
            observedHint = "stringified"
        }
        if (observedType) {
            result.set(col.key, {type: observedType, hint: observedHint})
        }
    }
    return result
}
