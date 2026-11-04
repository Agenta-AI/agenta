import {useCallback, useEffect, useMemo, useRef} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import type {TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

interface Column {
    key: string
    label?: string
    name?: string
}

export interface SuggestedColumn {
    key: string
    label: string
    type: string
}

const defaultValueForType = (type: string): unknown => {
    if (type === "object") return {}
    if (type === "array") return []
    if (type === "number" || type === "integer") return 0
    if (type === "boolean") return false
    return ""
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The form types every plain value as text. A number or boolean field must stay one, so text
 * typed into it goes back to the field's own type: the type the field had before the user
 * started typing, else the type the prompt's port declares. A half-typed "fa" is still text, and
 * the remembered type turns the finished "false" back into a boolean.
 */
const keepNativeType = (value: unknown, type?: string): unknown => {
    if (typeof value !== "string") return value
    if (type === "number" || type === "integer") {
        const number = Number(value)
        return value.trim() !== "" && Number.isFinite(number) ? number : value
    }
    if (type === "boolean") {
        const lower = value.toLowerCase()
        return lower === "true" ? true : lower === "false" ? false : value
    }
    return value
}

/**
 * The form of one test case in the focus drawer: the columns the row has, then the columns the
 * prompt references that the row lacks, shown with an empty value so the user can type at once.
 * An edit writes the row's own data plus only the missing columns the user filled in, so opening
 * a field does not add a `0` or `false` to a column nobody touched.
 */
export const usePlaygroundTestcaseEditorModel = (testcaseId: string) => {
    const entityData = useAtomValue(testcaseMolecule.data(testcaseId)) as {
        data?: Record<string, unknown>
    } | null
    const rawColumns = useAtomValue(testcaseMolecule.atoms.columns) as Column[] | null
    const schemaKeys = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    const schemaMap = useAtomValue(executionItemController.selectors.inputPortSchemaMap) as Record<
        string,
        {type: string; name?: string; schema?: unknown}
    >

    const labelFor = useCallback((key: string): string => schemaMap[key]?.name || key, [schemaMap])

    const existingColumns = useMemo<Column[]>(() => {
        const keys = Object.keys(entityData?.data ?? {}).filter(
            (key) => key !== "testcase_dedup_id",
        )
        const byKey = new Map((rawColumns ?? []).map((column) => [column.key, column]))
        return keys.map((key) => {
            const column = byKey.get(key)
            return {key, name: column?.name, label: column?.label || labelFor(key)}
        })
    }, [entityData?.data, rawColumns, labelFor])

    const suggestedColumns = useMemo<SuggestedColumn[]>(() => {
        const existingKeys = new Set(existingColumns.map((column) => column.key))
        return schemaKeys
            .filter((key) => !existingKeys.has(key))
            .map((key) => ({key, label: labelFor(key), type: schemaMap[key]?.type ?? "string"}))
    }, [existingColumns, schemaKeys, schemaMap, labelFor])

    const editorColumns = useMemo<TestcaseDataEditorColumn[]>(
        () => [
            ...existingColumns.map((column) => ({
                key: column.key,
                label: column.label ?? column.name ?? column.key,
                name: column.name,
                type: schemaMap[column.key]?.type,
                schema: schemaMap[column.key]?.schema,
                pathMode: "direct" as const,
            })),
            ...suggestedColumns.map((column) => ({
                key: column.key,
                label: column.label,
                name: column.key,
                type: column.type,
                schema: schemaMap[column.key]?.schema,
                pathMode: "direct" as const,
            })),
        ],
        [existingColumns, suggestedColumns, schemaMap],
    )

    const suggestedDefaults = useMemo(
        () =>
            Object.fromEntries(
                suggestedColumns.map((column) => [column.key, defaultValueForType(column.type)]),
            ),
        [suggestedColumns],
    )
    const editorValue = useMemo(
        () => ({...suggestedDefaults, ...(entityData?.data ?? {})}),
        [entityData?.data, suggestedDefaults],
    )

    // The last number or boolean each field held, kept while the user types text into it.
    const nativeTypes = useRef(new Map<string, string>())
    useEffect(() => {
        for (const [key, value] of Object.entries(entityData?.data ?? {})) {
            if (typeof value === "number" || typeof value === "boolean") {
                nativeTypes.current.set(`${testcaseId}:${key}`, typeof value)
            }
        }
    }, [entityData?.data, testcaseId])

    const updateTestcase = useSetAtom(testcaseMolecule.actions.update)
    const handleEditorChange = useCallback(
        (nextValue: Record<string, unknown>) => {
            const existing = entityData?.data ?? {}
            const data: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(nextValue)) {
                const isMissing = !(key in existing) && key in suggestedDefaults
                if (isMissing && sameValue(value, suggestedDefaults[key])) continue
                // Only a field the user changed gets its type restored.
                data[key] = sameValue(value, existing[key])
                    ? value
                    : keepNativeType(
                          value,
                          nativeTypes.current.get(`${testcaseId}:${key}`) ?? schemaMap[key]?.type,
                      )
            }
            updateTestcase(testcaseId, {data})
        },
        [entityData?.data, schemaMap, suggestedDefaults, testcaseId, updateTestcase],
    )

    return {
        entityData,
        existingColumns,
        editorColumns,
        editorValue,
        suggestedColumns,
        handleEditorChange,
    }
}
