/**
 * StubDrillIn — mounts the real DrillInContent against a local React state
 * tree, so design mockups can show the production component without
 * needing the entity/molecule/Jotai-atom plumbing.
 *
 * Use this when:
 * - The mockup just needs to demonstrate a single testcase shape
 * - You don't need the Fields ↔ JSON segmented toggle (use TestcaseDrillInView
 *   for that — see DataAuthoredDrillIn helper)
 *
 * Path navigation, breadcrumb, view-mode selector, type chip on the field
 * header, raw mode toggle, and column-mapping popover all work because
 * they're driven by props on DrillInContent itself.
 */

import {useCallback, useMemo, useState} from "react"

import type {PathItem} from "@/oss/components/DrillInView/DrillInContent"
import {DrillInContent} from "@/oss/components/DrillInView/DrillInContent"
import type {PropertyType} from "@/oss/components/DrillInView/DrillInControls"

interface StubDrillInProps {
    initialData: Record<string, unknown>
    rootTitle?: string
    editable?: boolean
    showFieldDrillIn?: boolean
    showFieldCollapse?: boolean
    /**
     * View-mode selector (Text / JSON / YAML / Markdown / Raw) on each field.
     * Default `false` to match production's testcase drawer surface
     * (`TestcaseDrillInView` doesn't enable view modes; only `TraceSpanDrillInView`
     * opts in). Enabling this routes primitives through SharedEditor with line
     * numbers instead of the proper `<Switch>` / `<InputNumber>` widgets.
     */
    enableFieldViewModes?: boolean
    /** Mark root items as columns (production testcase pattern). Default `true`. */
    rootIsColumn?: boolean
    columnOptions?: {value: string; label: string}[]
    onChange?: (data: Record<string, unknown>) => void
    /** Render the Add Property button at the root (production testcase pattern). */
    showAddControls?: boolean
    /** Render per-field delete buttons (production testcase pattern). */
    showDeleteControls?: boolean
    /**
     * Provide default values when a field's type is added/changed. Mirrors the
     * helper used by `TestcaseEditDrawer` so primitives, objects, and arrays
     * hydrate with sensible blanks.
     */
    getDefaultValueForType?: (type: PropertyType) => unknown
}

const DEFAULT_DEFAULT_VALUE_FOR_TYPE = (type: PropertyType): unknown => {
    switch (type) {
        case "string":
            return ""
        case "number":
            return 0
        case "boolean":
            return false
        case "object":
            return {}
        case "array":
            return []
        default:
            return ""
    }
}

function getAtPath(value: unknown, path: string[]): unknown {
    let cursor: unknown = value
    for (const segment of path) {
        if (cursor === null || cursor === undefined) return undefined
        if (Array.isArray(cursor)) {
            cursor = cursor[Number(segment)]
        } else if (typeof cursor === "object") {
            cursor = (cursor as Record<string, unknown>)[segment]
        } else {
            return undefined
        }
    }
    return cursor
}

function setAtPath(root: unknown, path: string[], nextValue: unknown): unknown {
    if (path.length === 0) return nextValue
    const [head, ...tail] = path
    if (Array.isArray(root)) {
        const idx = Number(head)
        const copy = [...root]
        copy[idx] = setAtPath(copy[idx], tail, nextValue)
        return copy
    }
    const obj = (root && typeof root === "object" ? root : {}) as Record<string, unknown>
    return {
        ...obj,
        [head]: setAtPath(obj[head], tail, nextValue),
    }
}

export function StubDrillIn({
    initialData,
    rootTitle = "Testcase",
    editable = true,
    showFieldDrillIn = true,
    showFieldCollapse = true,
    enableFieldViewModes = false,
    rootIsColumn = true,
    columnOptions,
    onChange,
    showAddControls = false,
    showDeleteControls = false,
    getDefaultValueForType = DEFAULT_DEFAULT_VALUE_FOR_TYPE,
}: StubDrillInProps) {
    const [data, setData] = useState<Record<string, unknown>>(initialData)

    const getValue = useCallback(
        (path: string[]) => {
            if (path.length === 0) return data
            return getAtPath(data, path)
        },
        [data],
    )

    const setValue = useCallback(
        (path: string[], next: unknown) => {
            setData((prev) => {
                const updated = setAtPath(prev, path, next) as Record<string, unknown>
                onChange?.(updated)
                return updated
            })
        },
        [onChange],
    )

    const getRootItems = useCallback((): PathItem[] => {
        return Object.entries(data).map(([key, value]) => ({
            key,
            name: key,
            value,
            isColumn: rootIsColumn,
        }))
    }, [data, rootIsColumn])

    const computedColumnOptions = useMemo(
        () => columnOptions ?? Object.keys(data).map((key) => ({value: key, label: key})),
        [columnOptions, data],
    )

    return (
        <DrillInContent
            getValue={getValue}
            setValue={setValue}
            getRootItems={getRootItems}
            rootTitle={rootTitle}
            editable={editable}
            showFieldDrillIn={showFieldDrillIn}
            showFieldCollapse={showFieldCollapse}
            enableFieldViewModes={enableFieldViewModes}
            columnOptions={computedColumnOptions}
            valueMode="native"
            showAddControls={showAddControls}
            showDeleteControls={showDeleteControls}
            getDefaultValueForType={getDefaultValueForType}
        />
    )
}

export default StubDrillIn
