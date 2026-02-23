export interface FocusedJsonDiffPreviewOptions {
    /** Minimum combined payload size that triggers focused preview mode. */
    triggerChars?: number
    /** Max number of leaf changes to include in focused preview. */
    maxChanges?: number
    /** Max number of entries to inspect in large arrays. */
    maxArrayScan?: number
    /** Max recursion depth for value summaries. */
    maxSummaryDepth?: number
}

export interface FocusedJsonDiffPreviewResult {
    original: string
    modified: string
    focused: boolean
    changedEntries: number
    truncated: boolean
}

type JsonObject = Record<string, unknown>

interface DiffState {
    changes: number
    truncated: boolean
}

interface NormalizedPreview {
    changed: boolean
    original?: unknown
    modified?: unknown
}

const DEFAULT_TRIGGER_CHARS = 200_000
const DEFAULT_MAX_CHANGES = 200
const DEFAULT_MAX_ARRAY_SCAN = 220
const DEFAULT_MAX_SUMMARY_DEPTH = 3

function isPlainObject(value: unknown): value is JsonObject {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function summarizeValue(
    value: unknown,
    {
        depth,
        maxDepth,
    }: {
        depth: number
        maxDepth: number
    },
): unknown {
    if (value === null || value === undefined) return value
    if (typeof value !== "object") return value
    if (depth >= maxDepth) {
        if (Array.isArray(value)) {
            return {__summary: "array", length: value.length}
        }
        return {
            __summary: "object",
            keys: Object.keys(value as JsonObject).length,
        }
    }

    if (Array.isArray(value)) {
        const head = value
            .slice(0, 2)
            .map((item) => summarizeValue(item, {depth: depth + 1, maxDepth}))
        const tail =
            value.length > 4
                ? value.slice(-2).map((item) => summarizeValue(item, {depth: depth + 1, maxDepth}))
                : []
        return {
            __summary: "array",
            length: value.length,
            head,
            ...(tail.length > 0 ? {tail} : {}),
        }
    }

    const entries = Object.entries(value as JsonObject).slice(0, 4)
    const preview: JsonObject = {}
    entries.forEach(([key, nested]) => {
        preview[key] = summarizeValue(nested, {depth: depth + 1, maxDepth})
    })
    const totalKeys = Object.keys(value as JsonObject).length
    if (totalKeys > entries.length) {
        preview.__omitted_keys__ = totalKeys - entries.length
    }
    return preview
}

function createArrayScanIndexes(length: number, maxScan: number): number[] {
    if (length <= 0) return []
    if (length <= maxScan) {
        return Array.from({length}, (_, index) => index)
    }

    const indexSet = new Set<number>()
    const edgeCount = Math.min(40, Math.floor(maxScan / 2))
    const middleCount = Math.max(0, maxScan - edgeCount * 2)

    for (let i = 0; i < edgeCount; i++) {
        indexSet.add(i)
        indexSet.add(length - 1 - i)
    }

    if (middleCount > 0) {
        for (let i = 0; i < middleCount; i++) {
            const index = Math.floor(((i + 1) / (middleCount + 1)) * (length - 1))
            indexSet.add(index)
        }
    }

    return Array.from(indexSet).sort((a, b) => a - b)
}

function diffNode(
    original: unknown,
    modified: unknown,
    {
        state,
        maxChanges,
        maxArrayScan,
        maxSummaryDepth,
        depth,
    }: {
        state: DiffState
        maxChanges: number
        maxArrayScan: number
        maxSummaryDepth: number
        depth: number
    },
): NormalizedPreview {
    if (Object.is(original, modified)) {
        return {changed: false}
    }

    if (state.changes >= maxChanges) {
        state.truncated = true
        return {
            changed: true,
            original: summarizeValue(original, {depth, maxDepth: maxSummaryDepth}),
            modified: summarizeValue(modified, {depth, maxDepth: maxSummaryDepth}),
        }
    }

    const originalIsArray = Array.isArray(original)
    const modifiedIsArray = Array.isArray(modified)

    if (originalIsArray && modifiedIsArray) {
        const originalArray = original as unknown[]
        const modifiedArray = modified as unknown[]
        const maxLength = Math.max(originalArray.length, modifiedArray.length)
        const scanIndexes = createArrayScanIndexes(maxLength, maxArrayScan)
        const changedOriginal: JsonObject = {__array_length__: originalArray.length}
        const changedModified: JsonObject = {__array_length__: modifiedArray.length}
        let changedCount = 0

        for (const index of scanIndexes) {
            if (state.changes >= maxChanges) {
                state.truncated = true
                break
            }

            const child = diffNode(originalArray[index], modifiedArray[index], {
                state,
                maxChanges,
                maxArrayScan,
                maxSummaryDepth,
                depth: depth + 1,
            })
            if (!child.changed) continue

            changedCount++
            changedOriginal[`[${index}]`] =
                child.original === undefined
                    ? summarizeValue(originalArray[index], {
                          depth: depth + 1,
                          maxDepth: maxSummaryDepth,
                      })
                    : child.original
            changedModified[`[${index}]`] =
                child.modified === undefined
                    ? summarizeValue(modifiedArray[index], {
                          depth: depth + 1,
                          maxDepth: maxSummaryDepth,
                      })
                    : child.modified
        }

        if (changedCount === 0) {
            // Could still differ in unscanned indexes for huge arrays.
            const scannedAll = scanIndexes.length >= maxLength
            if (!scannedAll) {
                state.changes++
                state.truncated = true
                return {
                    changed: true,
                    original: summarizeValue(originalArray, {depth, maxDepth: maxSummaryDepth}),
                    modified: summarizeValue(modifiedArray, {depth, maxDepth: maxSummaryDepth}),
                }
            }
            return {changed: false}
        }

        state.changes += 1
        const omitted = Math.max(0, maxLength - changedCount)
        if (omitted > 0) {
            changedOriginal.__omitted_entries__ = omitted
            changedModified.__omitted_entries__ = omitted
        }
        if (state.truncated) {
            changedOriginal.__truncated__ = true
            changedModified.__truncated__ = true
        }

        return {
            changed: true,
            original: changedOriginal,
            modified: changedModified,
        }
    }

    const originalIsObject = isPlainObject(original)
    const modifiedIsObject = isPlainObject(modified)

    if (originalIsObject && modifiedIsObject) {
        const originalObject = original as JsonObject
        const modifiedObject = modified as JsonObject
        const keys = Array.from(
            new Set([...Object.keys(originalObject), ...Object.keys(modifiedObject)]),
        ).sort()

        const changedOriginal: JsonObject = {}
        const changedModified: JsonObject = {}
        let changedKeys = 0

        for (const key of keys) {
            if (state.changes >= maxChanges) {
                state.truncated = true
                break
            }

            const child = diffNode(originalObject[key], modifiedObject[key], {
                state,
                maxChanges,
                maxArrayScan,
                maxSummaryDepth,
                depth: depth + 1,
            })
            if (!child.changed) continue

            changedKeys++
            changedOriginal[key] =
                child.original === undefined
                    ? summarizeValue(originalObject[key], {
                          depth: depth + 1,
                          maxDepth: maxSummaryDepth,
                      })
                    : child.original
            changedModified[key] =
                child.modified === undefined
                    ? summarizeValue(modifiedObject[key], {
                          depth: depth + 1,
                          maxDepth: maxSummaryDepth,
                      })
                    : child.modified
        }

        if (changedKeys === 0) return {changed: false}

        const omitted = Math.max(0, keys.length - changedKeys)
        if (omitted > 0) {
            changedOriginal.__omitted_keys__ = omitted
            changedModified.__omitted_keys__ = omitted
        }
        if (state.truncated) {
            changedOriginal.__truncated__ = true
            changedModified.__truncated__ = true
        }

        return {
            changed: true,
            original: changedOriginal,
            modified: changedModified,
        }
    }

    state.changes += 1
    return {
        changed: true,
        original: summarizeValue(original, {depth, maxDepth: maxSummaryDepth}),
        modified: summarizeValue(modified, {depth, maxDepth: maxSummaryDepth}),
    }
}

export function buildFocusedJsonDiffPreview({
    original,
    modified,
    triggerChars = DEFAULT_TRIGGER_CHARS,
    maxChanges = DEFAULT_MAX_CHANGES,
    maxArrayScan = DEFAULT_MAX_ARRAY_SCAN,
    maxSummaryDepth = DEFAULT_MAX_SUMMARY_DEPTH,
}: {
    original: string
    modified: string
} & FocusedJsonDiffPreviewOptions): FocusedJsonDiffPreviewResult {
    const combinedSize = original.length + modified.length
    if (combinedSize <= triggerChars) {
        return {
            original,
            modified,
            focused: false,
            changedEntries: 0,
            truncated: false,
        }
    }

    let parsedOriginal: unknown
    let parsedModified: unknown
    try {
        parsedOriginal = JSON.parse(original)
        parsedModified = JSON.parse(modified)
    } catch {
        return {
            original,
            modified,
            focused: false,
            changedEntries: 0,
            truncated: false,
        }
    }

    const state: DiffState = {
        changes: 0,
        truncated: false,
    }

    const preview = diffNode(parsedOriginal, parsedModified, {
        state,
        maxChanges,
        maxArrayScan,
        maxSummaryDepth,
        depth: 0,
    })

    if (!preview.changed) {
        return {
            original,
            modified,
            focused: false,
            changedEntries: 0,
            truncated: false,
        }
    }

    const wrappedOriginal: JsonObject = {
        __preview_mode__: "focused",
        __changed_entries__: state.changes,
        __truncated__: state.truncated,
        changes: preview.original ?? {},
    }
    const wrappedModified: JsonObject = {
        __preview_mode__: "focused",
        __changed_entries__: state.changes,
        __truncated__: state.truncated,
        changes: preview.modified ?? {},
    }

    return {
        original: JSON.stringify(wrappedOriginal, null, 2),
        modified: JSON.stringify(wrappedModified, null, 2),
        focused: true,
        changedEntries: state.changes,
        truncated: state.truncated,
    }
}
