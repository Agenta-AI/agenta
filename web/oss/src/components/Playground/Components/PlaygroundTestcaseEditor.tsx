import {useCallback, useMemo} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {
    TestcaseDataEditor,
    type RootDrawerViewMode,
    type TestcaseDataEditorColumn,
} from "@agenta/entity-ui/testcase"
import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

interface Column {
    key: string
    label?: string
    name?: string
}

interface SuggestedColumn {
    key: string
    label: string
    type: string
}

function defaultValueForType(type: string): unknown {
    if (type === "object") return {}
    if (type === "array") return []
    if (type === "number" || type === "integer") return 0
    if (type === "boolean") return false
    return ""
}

export function usePlaygroundTestcaseEditorModel(testcaseId: string) {
    const entityData = useAtomValue(testcaseMolecule.data(testcaseId))

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
        const byKey = new Map((rawColumns ?? []).map((col) => [col.key, col]))

        return keys.map((key) => {
            const column = byKey.get(key)
            return {
                key,
                name: column?.name,
                label: column?.label || labelFor(key),
            }
        })
    }, [entityData?.data, rawColumns, labelFor])

    const suggestedColumns = useMemo<SuggestedColumn[]>(() => {
        const existingKeys = new Set(existingColumns.map((c) => c.key))
        return schemaKeys
            .filter((key) => !existingKeys.has(key))
            .map((key) => ({
                key,
                label: labelFor(key),
                type: schemaMap[key]?.type ?? "string",
            }))
    }, [existingColumns, schemaKeys, schemaMap, labelFor])

    // All columns: existing ones first, then any schema fields not yet in the testcase.
    // Suggested columns are shown inline with empty defaults so users can start typing
    // without having to click "+ Add" first.
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
            ...suggestedColumns.map((col) => ({
                key: col.key,
                label: col.label,
                name: col.key,
                type: col.type,
                schema: schemaMap[col.key]?.schema,
                pathMode: "direct" as const,
            })),
        ],
        [existingColumns, suggestedColumns, schemaMap],
    )

    // Merge testcase data with empty defaults for suggested columns so the editor
    // renders all schema fields even before the user has typed anything.
    const editorValue = useMemo(() => {
        const existing = entityData?.data ?? {}
        const suggestedDefaults = Object.fromEntries(
            suggestedColumns.map((col) => [col.key, defaultValueForType(col.type)]),
        )
        return {...suggestedDefaults, ...existing}
    }, [entityData?.data, suggestedColumns])

    const updateTestcase = useSetAtom(testcaseMolecule.actions.update)

    const handleEditorChange = useCallback(
        (nextValue: Record<string, unknown>) => {
            updateTestcase(testcaseId, {data: nextValue})
        },
        [testcaseId, updateTestcase],
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

/**
 * Playground testcase editor.
 *
 * Renders all prompt-referenced columns (existing + suggested) through the
 * shared testcase data editor. Suggested columns (referenced by the prompt but
 * not yet in the testcase data) are shown inline with empty defaults so users
 * can start typing immediately without an extra click.
 */
function PlaygroundTestcaseEditor({
    testcaseId,
    initialPath,
    onPathChange,
    rootViewMode = "form",
    collapseSignal = 0,
}: {
    testcaseId: string
    initialPath?: string[]
    onPathChange?: (path: string[]) => void
    rootViewMode?: RootDrawerViewMode
    collapseSignal?: number
}) {
    const {editorColumns, editorValue, handleEditorChange} =
        usePlaygroundTestcaseEditorModel(testcaseId)

    return (
        <TestcaseDataEditor
            value={editorValue}
            columns={editorColumns}
            onChange={handleEditorChange}
            mode="edit"
            surface="playground"
            initialPath={initialPath}
            onPathChange={onPathChange}
            features={{
                typeChips: true,
                rootViewMode: false,
                columnMapping: false,
            }}
            rootViewMode={rootViewMode}
            collapseSignal={collapseSignal}
        />
    )
}

export default PlaygroundTestcaseEditor
