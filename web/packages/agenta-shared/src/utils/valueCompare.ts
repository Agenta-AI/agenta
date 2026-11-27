/**
 * An app output next to the value a test case expects, leaf by leaf. Pure: no React, no request.
 *
 * @packageDocumentation
 */

import {parseStructuredJson} from "./jsonParsing"

/**
 * `match` and `mismatch` compare a leaf on both sides; `missing` is a leaf the expected value has
 * and the output lacks; `extra` is a leaf only the output has, which is not compared.
 */
export type CompareStatus = "match" | "mismatch" | "missing" | "extra"

export interface CompareRow {
    key: string
    /** 0 for a top-level key; one more for each object above it. */
    depth: number
    output: unknown
    expected: unknown
    /** A group (an object on either side) takes the worst status of its leaves. */
    status: CompareStatus
    /** The rows of an object key, in output key order, then the keys only the expected has. */
    children: CompareRow[] | null
}

export interface ExpectedComparison {
    rows: CompareRow[]
    /** Leaves compared: those with match, mismatch or missing. */
    compared: number
    matched: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** A JSON text side becomes its parsed value; any other value stays as it is. */
const parsed = (value: unknown): unknown =>
    typeof value === "string" ? (parseStructuredJson(value) ?? value) : value

/** Deep equality where object key order does not matter. */
const same = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, index) => same(item, b[index]))
    }
    if (isRecord(a) && isRecord(b)) {
        const keys = Object.keys(a)
        return (
            keys.length === Object.keys(b).length &&
            keys.every((key) => key in b && same(a[key], b[key]))
        )
    }
    return false
}

const worst = (rows: CompareRow[]): CompareStatus => {
    const statuses = new Set(rows.map((row) => row.status))
    if (statuses.has("mismatch")) return "mismatch"
    if (statuses.has("missing")) return "missing"
    if (statuses.has("match")) return "match"
    return "extra"
}

function compareObjects(
    output: Record<string, unknown>,
    expected: Record<string, unknown>,
    depth: number,
): CompareRow[] {
    const keys = [
        ...Object.keys(output),
        ...Object.keys(expected).filter((key) => !(key in output)),
    ]
    return keys.map((key): CompareRow => {
        const inOutput = key in output
        const inExpected = key in expected
        const left = inOutput ? parsed(output[key]) : undefined
        const right = inExpected ? parsed(expected[key]) : undefined
        if (isRecord(left) && isRecord(right)) {
            const children = compareObjects(left, right, depth + 1)
            return {key, depth, output: left, expected: right, status: worst(children), children}
        }
        const status: CompareStatus = !inExpected
            ? "extra"
            : !inOutput
              ? "missing"
              : same(left, right)
                ? "match"
                : "mismatch"
        return {key, depth, output: left, expected: right, status, children: null}
    })
}

const countLeaves = (rows: CompareRow[], status?: CompareStatus): number =>
    rows.reduce(
        (sum, row) =>
            sum +
            (row.children
                ? countLeaves(row.children, status)
                : row.status !== "extra" && (!status || row.status === status)
                  ? 1
                  : 0),
        0,
    )

/**
 * Compare an output with its expected value. Each side that is JSON text is parsed first, so a
 * parsed object and a JSON string with the same content match. Null when either side is not an
 * object: only an object output shows as rows with an expected column.
 */
export function compareWithExpected(output: unknown, expected: unknown): ExpectedComparison | null {
    const left = parsed(output)
    const right = parsed(expected)
    if (!isRecord(left) || !isRecord(right)) return null
    const rows = compareObjects(left, right, 0)
    return {rows, compared: countLeaves(rows), matched: countLeaves(rows, "match")}
}
