import {useCallback, useMemo} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {TestcaseDataEditor, type TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
import {executionItemController} from "@agenta/playground"
import {Plus} from "@phosphor-icons/react"
import {Button, Tag, Typography} from "antd"
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

/**
 * Playground testcase editor.
 *
 * Renders existing testcase columns through the shared testcase data editor.
 * Prompt-referenced columns that don't yet exist on the testcase are listed
 * separately as "Suggested" — adding them is an explicit user action.
 *
 * Why the split: a testcase may legitimately NOT have a field that the prompt
 * references. Auto-creating it on prompt edit would conflate "referenced" with
 * "defined" and ship implicit structure. The user decides when a column
 * becomes real.
 */
function PlaygroundTestcaseEditor({testcaseId}: {testcaseId: string}) {
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

    const editorColumns = useMemo<TestcaseDataEditorColumn[]>(
        () =>
            existingColumns.map((column) => ({
                key: column.key,
                label: column.label ?? column.name ?? column.key,
                name: column.name,
                type: schemaMap[column.key]?.type,
                schema: schemaMap[column.key]?.schema,
                pathMode: "direct",
            })),
        [existingColumns, schemaMap],
    )

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

    const updateTestcase = useSetAtom(testcaseMolecule.actions.update)

    const handleAddSuggested = useCallback(
        (col: SuggestedColumn) => {
            const currentData = entityData?.data ?? {}
            if (col.key in currentData) return
            updateTestcase(testcaseId, {
                data: {...currentData, [col.key]: defaultValueForType(col.type)},
            })
        },
        [entityData, testcaseId, updateTestcase],
    )

    const handleEditorChange = useCallback(
        (nextValue: Record<string, unknown>) => {
            updateTestcase(testcaseId, {data: nextValue})
        },
        [testcaseId, updateTestcase],
    )

    return (
        <div>
            {existingColumns.length > 0 || suggestedColumns.length === 0 ? (
                <TestcaseDataEditor
                    value={entityData?.data ?? {}}
                    columns={editorColumns}
                    onChange={handleEditorChange}
                    mode="edit"
                    surface="playground"
                    features={{
                        typeChips: true,
                        rootViewMode: true,
                        columnMapping: false,
                    }}
                />
            ) : null}

            {suggestedColumns.length > 0 && (
                <div className="px-4 pb-3 pt-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Typography.Text
                            type="secondary"
                            className="text-xs uppercase tracking-wide"
                        >
                            Suggested from prompt
                        </Typography.Text>
                        <Typography.Text
                            type="secondary"
                            className="text-xs"
                            style={{fontSize: 11}}
                        >
                            Referenced by the prompt, not yet in this testcase. Missing is OK —
                            values default to absent.
                        </Typography.Text>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        {suggestedColumns.map((col) => (
                            <div
                                key={col.key}
                                className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-dashed border-[rgba(5,23,41,0.15)] bg-[rgba(5,23,41,0.02)]"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <Typography.Text
                                        className="font-[500] text-[12px] leading-[20px] text-[#758391] font-mono truncate"
                                        title={col.key}
                                    >
                                        {col.label}
                                    </Typography.Text>
                                    <Tag
                                        style={{
                                            fontSize: 10,
                                            lineHeight: "16px",
                                            margin: 0,
                                        }}
                                    >
                                        new
                                    </Tag>
                                </div>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<Plus size={14} />}
                                    onClick={() => handleAddSuggested(col)}
                                >
                                    Add
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

export default PlaygroundTestcaseEditor
