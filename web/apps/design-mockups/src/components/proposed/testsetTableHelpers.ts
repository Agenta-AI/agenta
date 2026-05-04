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
    /** Original row data preserved so cells can render values */
    [columnKey: string]: unknown
}

/**
 * Decide whether to expand a top-level object column into dotted-key
 * sub-columns. Production rule: expand when the key's value is an object
 * with the SAME shape across most rows (homogeneous). Heuristic here:
 * expand if at least two rows have the key + the value is a plain object
 * (not array, not null) with overlapping sub-keys.
 *
 * Imperfect but matches the visible behavior: `inputs` / `outputs` /
 * `geo` get expanded; `metadata` (mixed shapes per row) often doesn't.
 */
function shouldExpandObjectColumn(rows: StubRow[], key: string): boolean {
    const objectRows = rows.filter((r) => {
        const v = r.data[key]
        return (
            v !== null &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            Object.keys(v as object).length > 0
        )
    })
    if (objectRows.length < 2) return false
    // Cheap homogeneity check: at least one shared sub-key across all
    // object-rows for this column.
    const firstKeys = new Set(Object.keys(objectRows[0].data[key] as object))
    return objectRows.every((r) =>
        Object.keys(r.data[key] as object).some((k) => firstKeys.has(k)),
    )
}

/**
 * Compute the column union across rows. Top-level columns are union'd; if
 * a top-level column is a homogeneous object, expand into dotted-key
 * sub-columns marked with `parentKey` so groupColumns() groups them.
 */
export function computeColumns(rows: StubRow[]): ExpandedColumn[] {
    const topLevelKeys = new Set<string>()
    for (const row of rows) {
        for (const k of Object.keys(row.data)) {
            topLevelKeys.add(k)
        }
    }

    const columns: ExpandedColumn[] = []
    for (const key of topLevelKeys) {
        if (shouldExpandObjectColumn(rows, key)) {
            // Expand into dotted-key sub-columns (one level deep for the demo).
            const subKeys = new Set<string>()
            for (const row of rows) {
                const v = row.data[key]
                if (v !== null && typeof v === "object" && !Array.isArray(v)) {
                    for (const sk of Object.keys(v as object)) {
                        subKeys.add(sk)
                    }
                }
            }
            for (const subKey of subKeys) {
                const fullKey = `${key}.${subKey}`
                columns.push({
                    key: fullKey,
                    name: subKey,
                    parentKey: key,
                })
            }
        } else {
            columns.push({key, name: key})
        }
    }
    return columns
}

/**
 * Flatten a stub row into the table-row shape: { id, label, [columnKey]: value }.
 * Dotted-key columns read from the nested object; flat columns read the
 * top-level value. Missing keys produce `undefined` so the cell renderer
 * can decide between "—" (missing) and "" (empty string).
 */
export function flattenRow(row: StubRow, columns: ExpandedColumn[]): FlatRow {
    const out: FlatRow = {id: row.id, label: row.label}
    for (const col of columns) {
        if (col.parentKey) {
            const parent = row.data[col.parentKey]
            if (parent !== null && typeof parent === "object" && !Array.isArray(parent)) {
                const subKey = col.key.substring(col.parentKey.length + 1)
                out[col.key] = (parent as Record<string, unknown>)[subKey]
            } else {
                out[col.key] = undefined
            }
        } else {
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
